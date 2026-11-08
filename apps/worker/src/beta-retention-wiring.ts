import { createSecretManagerCredentialResolver } from "@draft-loop/model-gateway";
import { eraseOrganisation } from "@draft-loop/storage/organisation-erasure-flow";
import type { BlobErasure } from "@draft-loop/storage/record-erasure";
import { createPostgresTenantDirectory, type PostgresTenancy } from "@draft-loop/storage-postgres";

import { type BetaRetentionSummary, sweepBetaRetention } from "./beta-retention.js";
import { errorFields, logLine } from "./logging.js";
import { createBrevoMailSender, loggedMailSender, type MailConfig } from "./mail.js";

export interface BetaRetentionWiring {
  readonly databaseUrl: string;
  readonly databaseSchema: string;
  readonly tenancy: PostgresTenancy;
  readonly blobs: {
    readonly erasureFor: (tenantId: string) => BlobErasure;
    readonly prefixFor: (tenantId: string) => string;
  };
  readonly mail: MailConfig;
  readonly now?: () => Date;
}

const log = (
  severity: "INFO" | "WARNING" | "ERROR",
  message: string,
  fields: Record<string, unknown>,
) => {
  const line = logLine(severity, message, fields);
  if (severity === "INFO") console.info(line);
  else if (severity === "WARNING") console.warn(line);
  else console.error(line);
};

/**
 * Runs one beta retention sweep (#2540) over the deployment's directory, tenancy, blobs and mail
 * sender. It opens its own small directory pool and closes it when done; a failure is logged and
 * never stops the worker.
 */
export async function runBetaRetention(
  wiring: BetaRetentionWiring,
): Promise<BetaRetentionSummary | undefined> {
  const { tenancy, blobs, mail } = wiring;
  const resolveKey = createSecretManagerCredentialResolver({ secrets: { brevo: mail.keySecret } });
  const send = loggedMailSender(
    createBrevoMailSender({
      from: mail.from,
      apiKey: async () => {
        const key = await resolveKey("brevo");
        if (key === undefined) throw new Error("The mail key is missing.");
        return key;
      },
    }),
    {
      info: (fields, message) => log("INFO", message, fields),
      warn: (fields, message) => log("WARNING", message, fields),
    },
  );
  let directory: Awaited<ReturnType<typeof createPostgresTenantDirectory>> | undefined;
  try {
    directory = await createPostgresTenantDirectory({
      connectionString: wiring.databaseUrl,
      schema: wiring.databaseSchema,
      maxConnections: 1,
    });
    const opened = directory;
    const summary = await sweepBetaRetention(
      {
        inactiveSince: opened.organisationActivity.inactiveSince,
        markWarned: opened.organisationActivity.markWarned,
        clearWarning: opened.organisationActivity.clearWarning,
        planOf: async (organisationId) =>
          (await tenancy.forTenant(organisationId).organisationPlans.currentPlanAssignment())
            ?.planId,
        ownersOf: async (organisationId) => {
          const owners = (await opened.listMembers(organisationId)).filter(
            (member) => member.role === "owner" && member.status === "active",
          );
          return Promise.all(
            owners.map(async (owner) => ({
              email: owner.email,
              locale:
                (await opened.memberSettings.readScreenLanguage({
                  organisationId,
                  memberId: owner.memberId,
                })) === "fr"
                  ? ("fr" as const)
                  : ("en" as const),
            })),
          );
        },
        erase: (organisationId) => {
          const storage = tenancy.forTenant(organisationId);
          return eraseOrganisation({
            records: storage.recordErasure,
            organisation: storage.organisationErasure,
            blobs: blobs.erasureFor(organisationId),
            objectPrefix: blobs.prefixFor(organisationId),
          });
        },
        send,
        serviceUrl: mail.serviceUrl,
        log,
      },
      { now: (wiring.now ?? (() => new Date()))() },
    );
    if (summary.warned + summary.erased + summary.postponed > 0) {
      log("INFO", "beta retention swept", { ...summary });
    }
    return summary;
  } catch (error) {
    log("ERROR", "beta retention failed", { err: errorFields(error) });
    return undefined;
  } finally {
    await directory?.close();
  }
}
