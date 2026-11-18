import process from "node:process";

import { readRunBudgetCeiling } from "@draft-loop/application";
import {
  createPostgresTenantDirectory,
  startConfiguredCloudSqlProxy,
} from "@draft-loop/storage-postgres";
import { readApiMail } from "./api-mail.js";
import { buildApi } from "./app.js";
import { readCoverLetterWriter } from "./application-material-routes.js";
import { readBetaAccountCap } from "./beta-sign-up-routes.js";
import { readApiConfig, readHostedStorageConfig } from "./config.js";
import { readScreeningConfig } from "./content-screening-config.js";
import { contentScreeningSetup } from "./content-screening-service.js";
import { openHostedTenants } from "./hosted-application.js";
import { createInviteMailer } from "./invite-mail.js";
import { readLegalPublisher } from "./legal-pages.js";
import { liveSpeechFrom, readLiveSpeechConfig } from "./live-speech-config.js";
import { readLocalModels } from "./local-models-config.js";
import { cloudLoggingOptions, errorFields } from "./logging.js";
import { hostedJobPageFetcher } from "./page-fetcher-client.js";
import { paymentsFrom, readPaymentsConfig } from "./payments-config.js";
import type { ApiAuthOptions } from "./request-auth.js";
import { readScreeningShadowConfig, screeningShadowFrom } from "./screening-shadow-config.js";
import { readServiceNoticeSecret, secretServiceNotice } from "./service-notice.js";
import { readSupportSettings } from "./support-config.js";
import { readSupportLimitsSecret, secretSupportLimits } from "./support-limits.js";
import { createWaitlistConfirmMailer } from "./waitlist-confirm-mail.js";
import { cloudRunJobWake, noWake } from "./worker-wake.js";

const config = readApiConfig(process.env);
const supportSettings = readSupportSettings(process.env);
const supportLimitsSecret = readSupportLimitsSecret(process.env);
const localModels = readLocalModels(process.env);
const betaAccountCap = readBetaAccountCap(process.env);
// Beta invites and waitlist confirmations are emailed where the deployment sets a sender; a
// partial setting stops here.
const mail = readApiMail(process.env);
const legalPublisher = readLegalPublisher(process.env);
const serviceNoticeSecret = readServiceNoticeSecret(process.env);
const liveSpeech = liveSpeechFrom(readLiveSpeechConfig(process.env));
const coverLetterWriter = readCoverLetterWriter(process.env);
const payments = paymentsFrom(readPaymentsConfig(process.env));
const storageConfig = readHostedStorageConfig(process.env, config.auth.mode);
// Read before anything opens, so an unknown mode stops the start.
const screening = {
  ...contentScreeningSetup(readScreeningConfig(process.env)),
  ...screeningShadowFrom(readScreeningShadowConfig(process.env)),
};
// On Cloud Run, the database URL names the connector's socket and the API signs in as its service
// identity; elsewhere this does nothing.
const cloudSql = await startConfiguredCloudSqlProxy(process.env, "iam");
const hosted = await openHostedTenants(
  storageConfig,
  readRunBudgetCeiling(process.env),
  {
    wake: config.workerJob === undefined ? noWake : cloudRunJobWake({ jobName: config.workerJob }),
    // The run is queued; the scheduled sweep starts the worker if this wake failed.
    onWakeError: (error) =>
      console.error(
        JSON.stringify({
          severity: "WARNING",
          message: "worker wake failed",
          err: errorFields(error),
        }),
      ),
  },
  screening,
);
// Sign-in resolves each member's organisation, the tenant their requests act in, from the directory.
const directory =
  config.auth.mode === "oidc"
    ? await createPostgresTenantDirectory({
        connectionString: storageConfig.databaseUrl,
        schema: storageConfig.databaseSchema,
      })
    : undefined;
const auth: ApiAuthOptions =
  config.auth.mode === "oidc" && directory !== undefined
    ? { ...config.auth, resolveSignIn: directory.resolveSignIn }
    : { mode: "owner" };
const serverRelease =
  process.env.DRAFT_LOOP_SERVER_RELEASE?.trim() || process.env.K_REVISION?.trim() || undefined;
const app = await buildApi({
  ownerToken: config.ownerToken,
  auth,
  logger: cloudLoggingOptions(),
  rateLimits: config.rateLimits,
  support: supportSettings,
  ...(supportLimitsSecret === undefined
    ? {}
    : {
        supportLimits: secretSupportLimits({
          secret: supportLimitsSecret,
          // An unreadable or invalid value keeps the environment's limits, and says so.
          onReadError: (error) =>
            console.error(
              JSON.stringify({
                severity: "WARNING",
                message: "support limits read failed",
                err: errorFields(error),
              }),
            ),
        }),
      }),
  // The release a feedback note records (#2875): the deploy's own name for it, else Cloud Run's
  // revision.
  ...(serverRelease === undefined ? {} : { serverRelease }),
  tenants: {
    ...hosted.tenants,
    // Job pages go through the separate page fetcher where one is deployed (#1837): the API itself
    // has no route to the internet there.
    ...(config.pageFetcherUrl === undefined
      ? {}
      : { jobPageFetcher: hostedJobPageFetcher({ endpoint: config.pageFetcherUrl }) }),
  },
  ...(directory === undefined
    ? {}
    : {
        directory,
        memberSettings: directory.memberSettings,
        feedback: directory.feedback,
        betaInvites: { invites: directory.betaInvites, cap: betaAccountCap },
        ...(mail === undefined
          ? {}
          : {
              inviteMailer: createInviteMailer(mail),
              waitlistConfirmMailer: createWaitlistConfirmMailer(mail),
            }),
        // The waitlist and the public landing page exist only while the beta is open (#2567).
        ...(betaAccountCap > 0 ? { betaWaitlist: directory.betaWaitlist } : {}),
        organisationActivity: directory.organisationActivity,
        supportUsage: directory.supportUsage,
      }),
  ...(config.webRoot === undefined ? {} : { webRoot: config.webRoot }),
  ...(legalPublisher === undefined ? {} : { legalPublisher }),
  ...(serviceNoticeSecret === undefined
    ? {}
    : {
        serviceNotice: secretServiceNotice({
          secret: serviceNoticeSecret,
          onReadError: (error) =>
            console.error(
              JSON.stringify({
                severity: "WARNING",
                message: "service notice read failed",
                err: errorFields(error),
              }),
            ),
        }),
      }),
  ...(config.speechModelRoot === undefined ? {} : { speechModelRoot: config.speechModelRoot }),
  ...(localModels.length === 0 ? {} : { localModels }),
  ...(liveSpeech === undefined ? {} : { liveSpeech }),
  ...(payments === undefined
    ? {}
    : { payments: payments.checkout, paymentEvents: payments.events }),
  coverLetterWriter,
});

// Cloud Run sends SIGTERM before stopping an instance; finish in-flight requests, then exit.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    void app
      .close()
      .then(() => directory?.close())
      .then(() => hosted.close())
      .finally(() => cloudSql.close())
      .then(() => process.exit(0));
  });
}

await app.listen({ host: config.host, port: config.port });
