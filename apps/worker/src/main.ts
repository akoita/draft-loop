import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import process from "node:process";
import { createFactUsageService } from "@draft-loop/application/fact-usage";
import { materialReviewPorts } from "@draft-loop/application/material-review-ports";
import { researchFindingsPorts, researchScreen } from "@draft-loop/application/research-ports";
import { createRunSpanRecorder } from "@draft-loop/application/run-span-recorder";
import { createWritingSamplesService } from "@draft-loop/application/writing-samples";
import {
  hostedWorkspaceReference,
  openPostgresTenancy,
  startConfiguredCloudSqlProxy,
} from "@draft-loop/storage-postgres";

import { runBetaRetention } from "./beta-retention-wiring.js";
import { openTenantBlobs } from "./blob-backend.js";
import { claudeRefusalFallbackSetting } from "./claude-refusal-fallback.js";
import { readWorkerConfig } from "./config.js";
import { embeddingModelReadiness } from "./embedding-model.js";
import { failedCallLines } from "./failed-call-logging.js";
import { withLocalModels } from "./local-models-config.js";
import {
  errorFields,
  logLine,
  quarantineFields,
  runCreditsFields,
  runCreditsMessage,
  runOutcomeFields,
  runQualityFields,
  runQualityMessage,
} from "./logging.js";
import { readMailConfig } from "./mail.js";
import { modelCallLog } from "./model-call-log.js";
import { runQualityDigest } from "./quality-digest-sweep.js";
import { researchSearchFor } from "./research-search-wiring.js";
import { routeFields, routeProviderOptions } from "./route-config.js";
import { tenantRunCredits } from "./run-credit-settlement.js";
import { runSupportTicketRetention } from "./support-ticket-retention.js";
import { tenantRunQuarantine } from "./tenant-quarantine.js";
import {
  tenantAuthorConsent,
  tenantCompanyConsent,
  tenantRecordErased,
  tenantRunConsent,
  tenantServices,
  type WorkspaceJob,
} from "./tenant-services.js";
import { createTraceExport, traceExportConfig } from "./trace-export.js";
import { runWaitlistRetention } from "./waitlist-retention.js";
import { startWorker, stopOnSignals, stopWhenIdle } from "./worker.js";

// The worker's entry point: one pool, blob backend and queue opened at startup, serving every
// tenant.
// Each job names its tenant, and the application is composed over that tenant's view of them.
const config = readWorkerConfig(process.env);
// Transactional email is off unless the deployment sets a sender; a partial setting stops here.
const mail = readMailConfig(process.env);
if (config.modelRoutes !== undefined) {
  // Routes that process material outside the EU are deployment choices, so each start names them.
  console.info(logLine("INFO", "model routes", routeFields(config.modelRoutes)));
}
if (config.localModelEndpoint !== undefined) {
  console.info(logLine("INFO", "local model endpoint", { endpoint: config.localModelEndpoint }));
}
// Without its embedding model the critic judges no requirement coverage, so each start names the
// model's state (#1806).
const embeddingModel = await embeddingModelReadiness(process.env);
console.info(
  logLine(embeddingModel.state === "ready" ? "INFO" : "WARNING", "embedding model", embeddingModel),
);
// On Cloud Run, the database URL names the connector's socket and the worker signs in as its
// service identity; elsewhere this does nothing.
const cloudSql = await startConfiguredCloudSqlProxy(process.env, "iam");
const tenancy = await openPostgresTenancy({
  connectionString: config.databaseUrl,
  schema: config.databaseSchema,
  maxConnections: config.databasePoolSize,
});
const blobs = openTenantBlobs(config.blobs);
// Claude on Vertex AI and OpenAI's EU endpoint with keys from Secret Manager, the self-hosted
// direct routes with keys from files, or none on the dev stack; local models go to the
// deployment's own endpoint.
// Claude's refusal fallback (#3275) reads the API's model call switch before each retry.
const refusalFallback = claudeRefusalFallbackSetting(config.claudeRefusalFallback, process.env, {
  onReadError: (error) =>
    console.warn(logLine("WARNING", "model call switch unreadable", { err: errorFields(error) })),
});
if (refusalFallback !== undefined) {
  console.info(logLine("INFO", "claude refusal fallback", { model: refusalFallback.modelId }));
}
const routed = withLocalModels(
  routeProviderOptions(
    config.modelRoutes,
    refusalFallback === undefined ? {} : { refusalFallback },
  ),
  config.localModelEndpoint,
);
// Each brief extraction and profile derivation call logs its model, tokens and cost (#2806).
const local = {
  ...routed,
  providerClientFactories: { ...routed.providerClientFactories, meter: modelCallLog() },
};
const serviceFor = tenantServices({ tenancy, blobsFor: blobs.storageFor, local });
// The research brief's web search (#2560), from DRAFT_LOOP_RESEARCH_SEARCH; none searches nothing.
const researchSearch = researchSearchFor(process.env, config.modelRoutes, local);
const screenSource = researchScreen();

// Run spans also go to Cloud Trace where DRAFT_LOOP_TRACE_EXPORT=cloud-trace (#3238); content-free.
const traceExportSettings = traceExportConfig(process.env);
const traceExport =
  traceExportSettings === undefined
    ? undefined
    : createTraceExport(traceExportSettings, {
        onError: (error) =>
          console.error(logLine("ERROR", "trace export failed", { err: errorFields(error) })),
      });

const workspaceRoot = (job: WorkspaceJob) =>
  hostedWorkspaceReference(job.tenantId, job.workspaceId);
// In a sign-in deployment, each job checks its record's consent again before any provider call.
const consentFor = config.requireConsent
  ? tenantRunConsent({ tenancy, serviceFor, workspaceRoot })
  : undefined;
// A profile derivation and a brief extraction call only the author's model, so they need the
// author's company (#2811).
const authorConsentFor = config.requireConsent
  ? tenantAuthorConsent({ tenancy, serviceFor, workspaceRoot })
  : undefined;
// The fallback critic (#3131) needs the record's consent to name its company in a sign-in
// deployment; elsewhere the deployment's provider setting is the only gate.
const companyConsentFor = config.requireConsent
  ? tenantCompanyConsent({ tenancy, serviceFor, workspaceRoot })
  : undefined;
const { criticFallback } = config;
// A job queued before its record was erased ends without touching the record.
const recordErased = tenantRecordErased({ tenancy, serviceFor, workspaceRoot });

const worker = await startWorker({
  queue: {
    connectionString: config.databaseUrl,
    schema: config.queueSchema,
    maxConnections: config.queuePoolSize,
    onError: (error) =>
      console.error(logLine("ERROR", "run queue error", { err: errorFields(error) })),
  },
  runs: {
    serviceFor: (job) => serviceFor(job.tenantId),
    workspaceRoot,
    allowProviderData: config.allowProviderData,
    ...(consentFor === undefined ? {} : { consentFor }),
    // The run's content-free spans (#2686); a failed save is logged and never reaches the run.
    spansFor: (job) => {
      const recorder = createRunSpanRecorder({
        store: tenancy.forTenant(job.tenantId).runSpans,
        workspaceId: job.workspaceId,
        runId: job.runId,
        ...(job.requestId === undefined ? {} : { requestId: job.requestId }),
        onError: (error) =>
          console.error(logLine("ERROR", "run span not saved", { err: errorFields(error) })),
      });
      // The same spans in Cloud Trace when the deployment turns export on (#3238).
      return traceExport === undefined ? recorder : traceExport.wrap(recorder, job.traceparent);
    },
    ...(criticFallback === undefined
      ? {}
      : {
          criticFallbackFor: (job: WorkspaceJob) => ({
            ...criticFallback,
            permitted: async () =>
              companyConsentFor === undefined ||
              (await companyConsentFor(job, criticFallback.company)),
          }),
        }),
    budgetCeiling: config.budgetCeiling,
    // Material flagged after a run was queued, or with no result while screening is on, pauses the
    // run before any provider call.
    quarantinedFor: tenantRunQuarantine({
      tenancy,
      serviceFor,
      workspaceRoot,
      requireScreening: config.requireScreening,
    }),
    onQuarantined: (job, quarantined) =>
      console.warn(
        logLine(
          "WARNING",
          "run paused for quarantined material",
          quarantineFields(job, quarantined),
        ),
      ),
    // A run's reserved credits are settled when it has a draft and refunded when it ended without
    // one; a deployment with no reservations (owner-token mode) does nothing here.
    credits: tenantRunCredits({
      tenancy,
      onClosed: (closed) =>
        console.info(logLine("INFO", runCreditsMessage, runCreditsFields(closed))),
      onSweepError: (tenantId, error) =>
        console.error(
          logLine("ERROR", "run credit reconciliation failed", {
            tenantId,
            err: errorFields(error),
          }),
        ),
    }),
    recordErased,
    onOutcome: (job, outcome, run, before) => {
      for (const line of failedCallLines(job, run, before)) console.error(line);
      console.info(logLine("INFO", "run job finished", runOutcomeFields(job, outcome, run)));
      const quality = runQualityFields(job, outcome, run, before);
      if (quality !== undefined) console.info(logLine("INFO", runQualityMessage, quality));
    },
  },
  // A live brief saved before screening is extracted here, once the API queues it (ADR 0011, D9).
  briefs: {
    serviceFor: (job) => serviceFor(job.tenantId),
    workspaceRoot,
    allowProviderData: config.allowProviderData,
    // Extraction calls only the author's model, so it needs the author's company, as a profile
    // derivation does: a record consented to its writing model alone must still get requirements.
    ...(authorConsentFor === undefined ? {} : { consentFor: authorConsentFor }),
    recordErased,
    // The job is ids only, so its line carries no candidate material.
    onOutcome: (job, outcome) =>
      console.info(logLine("INFO", "brief extraction finished", { ...job, outcome })),
  },
  // The career profile is derived here once the API queues it, as the desktop derives it locally.
  profiles: {
    serviceFor: (job) => serviceFor(job.tenantId),
    workspaceRoot,
    allowProviderData: config.allowProviderData,
    ...(authorConsentFor === undefined ? {} : { consentFor: authorConsentFor }),
    recordErased,
    // Ids, flags and the outcome's fixed words only: no candidate material.
    onOutcome: (job, outcome) =>
      console.info(logLine("INFO", "profile derivation finished", { ...job, ...outcome })),
  },
  // A saved cover letter gets one critic pass here once the API queues it (#2525).
  reviews: {
    serviceFor: (job) => serviceFor(job.tenantId),
    draftsFor: (job) => tenancy.forTenant(job.tenantId).savedApplicationMaterial,
    settingsFor: (job) => {
      const settings = tenancy.forTenant(job.tenantId).workspaceSettings;
      return {
        writingSamples: createWritingSamplesService(settings),
        factUsage: createFactUsageService(settings),
      };
    },
    workspaceRoot,
    allowProviderData: config.allowProviderData,
    ...(consentFor === undefined ? {} : { consentFor }),
    recordErased,
    portsFor: (job, models) =>
      materialReviewPorts({
        ...models,
        local,
        onCall: (call) =>
          console.info(logLine("INFO", "material review model call", { ...job, ...call })),
      }),
    newId: () => `amd_${randomBytes(12).toString("base64url")}`,
    // Ids, counts and the outcome's word only: no candidate material.
    onOutcome: (job, outcome, detail) =>
      console.info(logLine("INFO", "material review finished", { ...job, outcome, ...detail })),
  },
  // An application the candidate approved is researched here once the API queues it (#2560).
  research: {
    serviceFor: (job) => serviceFor(job.tenantId),
    briefsFor: (job) => tenancy.forTenant(job.tenantId).researchBriefs,
    workspaceRoot,
    allowProviderData: config.allowProviderData,
    ...(consentFor === undefined ? {} : { consentFor }),
    recordErased,
    portsFor: (job) => {
      if (researchSearch === undefined) return undefined;
      const model = researchFindingsPorts({
        applicationId: job.applicationId,
        allowProviderData: config.allowProviderData,
        local,
        onCall: (call) => console.info(logLine("INFO", "research model call", { ...job, ...call })),
      });
      return {
        search: researchSearch,
        screen: screenSource,
        findings: model.findings,
        findingsSpentUsd: model.spentUsd,
      };
    },
    newId: () => `rbr_${randomBytes(12).toString("base64url")}`,
    // Ids, counts, cost and the outcome's word only: never the sources or findings.
    onOutcome: (job, result, detail) =>
      console.info(logLine("INFO", "research finished", { ...job, ...result, ...detail })),
  },
});
if (config.readyFile !== undefined) await writeFile(config.readyFile, `${process.pid}\n`);
// Waitlist entries nobody invited go after six months (#2568); this needs no mail sender.
void runWaitlistRetention({
  databaseUrl: config.databaseUrl,
  databaseSchema: config.databaseSchema,
});
// Support tickets and their shared conversations go after 90 days (#2883).
void runSupportTicketRetention({
  databaseUrl: config.databaseUrl,
  databaseSchema: config.databaseSchema,
});

// Yesterday's content-free quality digest (#2916), built by the day's first worker start.
void runQualityDigest({
  databaseUrl: config.databaseUrl,
  databaseSchema: config.databaseSchema,
});

// The beta's retention sweep (#2540) runs once per start, beside the jobs; without a mail sender
// nobody is warned, so nobody is erased, and it does not run at all.
if (mail !== undefined) {
  void runBetaRetention({
    databaseUrl: config.databaseUrl,
    databaseSchema: config.databaseSchema,
    tenancy,
    blobs,
    mail,
  });
}

let stopped = false;
const onStopped = (error?: unknown) => {
  if (stopped) return;
  stopped = true;
  if (error !== undefined) {
    console.error(logLine("ERROR", "worker stopped with an error", { err: errorFields(error) }));
  }
  void (traceExport?.shutdown() ?? Promise.resolve())
    .then(() => tenancy.close())
    .finally(() => cloudSql.close())
    .finally(() => process.exit(error === undefined ? 0 : 1));
};
stopOnSignals(worker, { onStopped });
if (config.mode.kind === "drain") {
  // A job claimed as the worker stops may run to the deployment's longest run.
  stopWhenIdle(worker, {
    idleMs: config.mode.idleMs,
    graceMs: config.budgetCeiling.maxDurationMs,
    onStopped,
  });
}
