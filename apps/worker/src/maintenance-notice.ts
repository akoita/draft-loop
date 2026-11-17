/**
 * The planned-maintenance email (#2968): one fixed message to every active member, sent by the
 * operator before a maintenance window. It names the window and what members can still do, never
 * a cause. A dry run reports only how many members would receive it and the text, never an
 * address.
 */

import { WorkerConfigError } from "./config-error.js";
import type { MailLocale, MailMessage } from "./mail.js";

export interface MaintenanceWindow {
  readonly startsAt: Date;
  readonly endsAt: Date;
  /** True when changes are paused during it. */
  readonly readOnly: boolean;
}

/** Members are in the EU: times are written in Paris time and say so. */
const timeZone = "Europe/Paris";

function windowText(window: MaintenanceWindow, locale: MailLocale): string {
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone,
  }).formatRange(window.startsAt, window.endsAt);
}

/** The message in the member's screen language. */
export function maintenanceNotice(
  window: MaintenanceWindow,
  locale: MailLocale,
  serviceUrl: string,
): Pick<MailMessage, "subject" | "text"> {
  const when = windowText(window, locale);
  if (locale === "fr") {
    return {
      subject: "Maintenance planifiée de DraftLoop",
      text: [
        "Bonjour,",
        "",
        `DraftLoop fera l'objet d'une maintenance planifiée : ${when} (heure de Paris).`,
        "",
        window.readOnly
          ? "Pendant ce temps, vous pourrez toujours consulter et télécharger vos documents, mais les modifications seront suspendues."
          : "Le service pourra être brièvement indisponible pendant ce temps.",
        "Si vous souhaitez garder une copie de vos documents, téléchargez-la avant cette date.",
        "",
        `Vous n'avez rien d'autre à faire : le service reprend de lui-même. ${serviceUrl}`,
        "",
        "L'équipe DraftLoop",
      ].join("\n"),
    };
  }
  return {
    subject: "Planned maintenance on DraftLoop",
    text: [
      "Hello,",
      "",
      `DraftLoop has planned maintenance: ${when} (Paris time).`,
      "",
      window.readOnly
        ? "During it you can still read and download your documents, but changes will be paused."
        : "The service may be briefly unavailable during it.",
      "If you want a copy of your documents, download it before then.",
      "",
      `Nothing else is needed from you: the service comes back on its own. ${serviceUrl}`,
      "",
      "The DraftLoop team",
    ].join("\n"),
  };
}

export interface NoticeRecipient {
  readonly email: string;
  readonly locale: MailLocale;
}

export interface NotifyMembersPorts {
  /** Every active member of every organisation; the same address may appear more than once. */
  readonly recipients: () => Promise<readonly NoticeRecipient[]>;
  /** Sends one message; resolves false when the provider refused it. */
  readonly send: (message: MailMessage) => Promise<boolean>;
}

export interface NotifyMembersSummary {
  readonly recipients: number;
  readonly sent: number;
  readonly failed: number;
  readonly dryRun: boolean;
}

/** Sends the notice once per address, or with `dryRun` only counts who would receive it. */
export async function notifyMembers(
  ports: NotifyMembersPorts,
  window: MaintenanceWindow,
  serviceUrl: string,
  dryRun: boolean,
): Promise<NotifyMembersSummary> {
  const unique = new Map<string, NoticeRecipient>();
  for (const recipient of await ports.recipients()) {
    const key = recipient.email.trim().toLowerCase();
    if (key !== "" && !unique.has(key)) unique.set(key, recipient);
  }
  let sent = 0;
  let failed = 0;
  if (!dryRun) {
    for (const recipient of unique.values()) {
      const message = maintenanceNotice(window, recipient.locale, serviceUrl);
      if (await ports.send({ to: recipient.email, ...message })) sent += 1;
      else failed += 1;
    }
  }
  return { recipients: unique.size, sent, failed, dryRun };
}

/**
 * Reads the window from `DRAFT_LOOP_NOTICE_STARTS_AT`, `DRAFT_LOOP_NOTICE_ENDS_AT` (ISO 8601)
 * and `DRAFT_LOOP_NOTICE_READ_ONLY`, and the send switch from `DRAFT_LOOP_NOTICE_SEND`: only
 * `yes` sends; anything else is a dry run.
 */
export function readNoticeRequest(env: NodeJS.ProcessEnv): {
  readonly window: MaintenanceWindow;
  readonly dryRun: boolean;
} {
  const date = (name: string): Date => {
    const text = env[name]?.trim() ?? "";
    const value = new Date(text);
    if (text === "" || Number.isNaN(value.getTime()) || !/T.*(Z|[+-]\d\d:\d\d)$/u.test(text)) {
      throw new WorkerConfigError(`${name} must be an ISO 8601 time with its offset.`);
    }
    return value;
  };
  const startsAt = date("DRAFT_LOOP_NOTICE_STARTS_AT");
  const endsAt = date("DRAFT_LOOP_NOTICE_ENDS_AT");
  if (endsAt <= startsAt) {
    throw new WorkerConfigError("DRAFT_LOOP_NOTICE_ENDS_AT must be after the start.");
  }
  return {
    window: { startsAt, endsAt, readOnly: env.DRAFT_LOOP_NOTICE_READ_ONLY?.trim() === "true" },
    dryRun: env.DRAFT_LOOP_NOTICE_SEND?.trim() !== "yes",
  };
}
