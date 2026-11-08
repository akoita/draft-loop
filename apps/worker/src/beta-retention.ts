/**
 * The public beta's retention (#2540, #2463): a Beta-plan organisation nobody has used for 90 days
 * is erased, after its owners were warned by email at least 14 days before. The sweep runs each
 * time the worker starts; it is idempotent, so running it often is safe and cheap.
 *
 * - Only organisations on the `beta` plan are touched.
 * - Without a mail sender nobody is warned, so nobody is erased.
 * - A member request clears the warning (`organisation_activity`), so an account that comes back
 *   before the deadline is kept.
 * - Erasure takes the same path as `DELETE /v1/organisation`; an active run postpones it.
 * - Log lines carry the organisation id and counts, never an address or content.
 */

import type { OrganisationErasureOutcome } from "@draft-loop/storage/organisation-erasure-flow";

import type { MailLocale, MailMessage, MailTemplateId } from "./mail.js";
import { inactivityWarning } from "./mail.js";

const dayMs = 24 * 60 * 60 * 1000;

export interface RetentionActivityRow {
  readonly organisationId: string;
  readonly lastActiveAt: string;
  readonly warnedAt: string | null;
}

export interface BetaRetentionPorts {
  readonly inactiveSince: (cutoff: Date, limit: number) => Promise<readonly RetentionActivityRow[]>;
  readonly markWarned: (organisationId: string, now: Date) => Promise<boolean>;
  readonly clearWarning: (organisationId: string) => Promise<void>;
  /** The organisation's current plan id, or undefined without one. */
  readonly planOf: (organisationId: string) => Promise<string | undefined>;
  /** The active owners' addresses and screen languages. */
  readonly ownersOf: (
    organisationId: string,
  ) => Promise<readonly { readonly email: string; readonly locale: MailLocale }[]>;
  readonly erase: (organisationId: string) => Promise<OrganisationErasureOutcome>;
  /** Sends one message and logs it; resolves whether it was sent. Undefined when mail is off. */
  readonly send?:
    | ((template: MailTemplateId, message: MailMessage) => Promise<boolean>)
    | undefined;
  readonly serviceUrl?: string | undefined;
  readonly log: (
    severity: "INFO" | "WARNING" | "ERROR",
    message: string,
    fields: Record<string, unknown>,
  ) => void;
}

export interface BetaRetentionOptions {
  readonly now: Date;
  /** Days without activity before erasure. */
  readonly eraseAfterDays?: number;
  /** Days between the warning and the earliest erasure. */
  readonly noticeDays?: number;
  /** The most organisations one sweep looks at. */
  readonly maxRows?: number;
}

export interface BetaRetentionSummary {
  readonly warned: number;
  readonly erased: number;
  readonly postponed: number;
}

export const betaPlanId = "beta";

/** Warns and erases inactive Beta organisations; returns what it did. */
export async function sweepBetaRetention(
  ports: BetaRetentionPorts,
  options: BetaRetentionOptions,
): Promise<BetaRetentionSummary> {
  const eraseAfterMs = (options.eraseAfterDays ?? 90) * dayMs;
  const noticeMs = (options.noticeDays ?? 14) * dayMs;
  const now = options.now;
  const warnCutoff = new Date(now.getTime() - (eraseAfterMs - noticeMs));
  const rows = await ports.inactiveSince(warnCutoff, options.maxRows ?? 500);
  let warned = 0;
  let erased = 0;
  let postponed = 0;
  let mailOffLogged = false;

  for (const row of rows) {
    const { organisationId } = row;
    if ((await ports.planOf(organisationId)) !== betaPlanId) continue;
    const lastActive = Date.parse(row.lastActiveAt);

    if (row.warnedAt === null) {
      if (ports.send === undefined || ports.serviceUrl === undefined) {
        if (!mailOffLogged) {
          ports.log("WARNING", "beta retention warning not sent: mail is off", {});
          mailOffLogged = true;
        }
        continue;
      }
      if (!(await ports.markWarned(organisationId, now))) continue;
      const eraseOn = new Date(Math.max(lastActive + eraseAfterMs, now.getTime() + noticeMs));
      let sent = 0;
      for (const owner of await ports.ownersOf(organisationId)) {
        const message = inactivityWarning({
          locale: owner.locale,
          eraseOn,
          serviceUrl: ports.serviceUrl,
        });
        if (await ports.send("beta_inactivity_warning", { to: owner.email, ...message })) sent += 1;
      }
      if (sent === 0) {
        await ports.clearWarning(organisationId);
        continue;
      }
      warned += 1;
      ports.log("INFO", "inactive beta organisation warned", {
        organisationId,
        eraseOn: eraseOn.toISOString().slice(0, 10),
      });
      continue;
    }

    const warnedAt = Date.parse(row.warnedAt);
    if (now.getTime() < warnedAt + noticeMs || now.getTime() < lastActive + eraseAfterMs) continue;
    const outcome = await ports.erase(organisationId);
    if (outcome.state === "run-active") {
      postponed += 1;
      continue;
    }
    if (outcome.state === "erased") {
      erased += 1;
      ports.log("INFO", "inactive beta organisation erased", {
        erasure: {
          organisationId,
          records: outcome.records,
          objectsRemoved: outcome.objectsRemoved,
          rowsRemoved: outcome.rowsRemoved,
        },
      });
    }
  }
  return { warned, erased, postponed };
}
