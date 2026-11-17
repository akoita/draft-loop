import process from "node:process";
import { createSecretManagerCredentialResolver } from "@draft-loop/model-gateway";
import {
  createPostgresTenantDirectory,
  startConfiguredCloudSqlProxy,
} from "@draft-loop/storage-postgres";

import { readWorkerConfig } from "./config.js";
import { logLine } from "./logging.js";
import { createBrevoMailSender, readMailConfig } from "./mail.js";
import {
  maintenanceNotice,
  type NoticeRecipient,
  notifyMembers,
  readNoticeRequest,
} from "./maintenance-notice.js";

// The planned-maintenance email (#2968), run by the operator's workflow on the worker's image:
// `tsx src/notify-members.ts`. A dry run, the default, prints the count and the English and French
// text; `DRAFT_LOOP_NOTICE_SEND=yes` sends. Logs never carry an address.
const config = readWorkerConfig(process.env);
const mail = readMailConfig(process.env);
const { window, dryRun } = readNoticeRequest(process.env);
// Without mail (staging), a dry run still counts the members and prints the text, so the operator
// can check the workflow; only a real send needs mail.
if (mail === undefined && !dryRun) {
  throw new Error("Mail is off in this deployment: nothing can be sent.");
}
const serviceUrl = mail?.serviceUrl ?? publicOrigin(process.env.DRAFT_LOOP_PUBLIC_URL);

const cloudSql = await startConfiguredCloudSqlProxy(process.env, "iam");
const directory = await createPostgresTenantDirectory({
  connectionString: config.databaseUrl,
  schema: config.databaseSchema,
  maxConnections: 1,
});
const send =
  mail === undefined
    ? undefined
    : createBrevoMailSender({
        from: mail.from,
        apiKey: async () => {
          const key = await createSecretManagerCredentialResolver({
            secrets: { brevo: mail.keySecret },
          })("brevo");
          if (key === undefined) throw new Error("The mail key is missing.");
          return key;
        },
      });

try {
  for (const locale of ["en", "fr"] as const) {
    const message = maintenanceNotice(window, locale, serviceUrl);
    console.info(logLine("INFO", "maintenance notice text", { locale, ...message }));
  }
  const summary = await notifyMembers(
    {
      recipients: async () => {
        // Every organisation that was ever active; well under the read's limit during the beta.
        const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
        const organisations = await directory.organisationActivity.inactiveSince(farFuture, 1000);
        const recipients: NoticeRecipient[] = [];
        for (const { organisationId } of organisations) {
          for (const member of await directory.listMembers(organisationId)) {
            if (member.status !== "active") continue;
            const language = await directory.memberSettings.readScreenLanguage({
              organisationId,
              memberId: member.memberId,
            });
            recipients.push({ email: member.email, locale: language === "fr" ? "fr" : "en" });
          }
        }
        return recipients;
      },
      send: async (message) => {
        if (send === undefined) return false;
        try {
          await send(message);
          return true;
        } catch {
          return false;
        }
      },
    },
    window,
    serviceUrl,
    dryRun,
  );
  console.info(
    logLine("INFO", dryRun ? "maintenance notice dry run" : "maintenance notice sent", {
      ...summary,
    }),
  );
  if (summary.failed > 0) process.exitCode = 1;
} finally {
  await directory.close();
  await cloudSql.close();
}

/** The service's address for the text; a placeholder when the deployment names none. */
function publicOrigin(value: string | undefined): string {
  try {
    const url = new URL(value?.trim() ?? "");
    if (url.protocol === "https:") return url.origin;
  } catch {
    // Falls through to the placeholder.
  }
  return "https://draftloop.example";
}
