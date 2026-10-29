import { writeFile } from "node:fs/promises";
import process from "node:process";
import {
  hostedWorkspaceReference,
  openPostgresTenancy,
  startConfiguredCloudSqlProxy,
} from "@draft-loop/storage-postgres";

import { openTenantBlobs } from "./blob-backend.js";
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
} from "./logging.js";
import { routeFields, routeProviderOptions } from "./route-config.js";
import { tenantRunCredits } from "./run-credit-settlement.js";
import { tenantRunQuarantine } from "./tenant-quarantine.js";
import {
  tenantRecordErased,
  tenantRunConsent,
  tenantServices,
  type WorkspaceJob,
} from "./tenant-services.js";
import { startWorker, stopOnSignals, stopWhenIdle } from "./worker.js";

// The worker's entry point: one pool, blob backend and queue opened at startup, serving every
// tenant.
// Each job names its tenant, and the application is composed over that tenant's view of them.
const config = readWorkerConfig(process.env);
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
});
const blobs = openTenantBlobs(config.blobs);
const serviceFor = tenantServices({
  tenancy,
  blobsFor: blobs.storageFor,
  // Claude on Vertex AI and OpenAI's EU endpoint with keys from Secret Manager, the self-hosted
  // direct routes with keys from files, or none on the dev stack; local models go to the
  // deployment's own endpoint.
  local: withLocalModels(routeProviderOptions(config.modelRoutes), config.localModelEndpoint),
});

const workspaceRoot = (job: WorkspaceJob) =>
  hostedWorkspaceReference(job.tenantId, job.workspaceId);
// In a sign-in deployment, each job checks its record's consent again before any provider call.
const consentFor = config.requireConsent
  ? tenantRunConsent({ tenancy, serviceFor, workspaceRoot })
  : undefined;
// A job queued before its record was erased ends without touching the record.
const recordErased = tenantRecordErased({ tenancy, serviceFor, workspaceRoot });

const worker = await startWorker({
  queue: {
    connectionString: config.databaseUrl,
    schema: config.queueSchema,
    onError: (error) =>
      console.error(logLine("ERROR", "run queue error", { err: errorFields(error) })),
  },
  runs: {
    serviceFor: (job) => serviceFor(job.tenantId),
    workspaceRoot,
    allowProviderData: config.allowProviderData,
    ...(consentFor === undefined ? {} : { consentFor }),
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
    },
  },
  // A live brief saved before screening is extracted here, once the API queues it (ADR 0011, D9).
  briefs: {
    serviceFor: (job) => serviceFor(job.tenantId),
    workspaceRoot,
    allowProviderData: config.allowProviderData,
    ...(consentFor === undefined ? {} : { consentFor }),
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
    ...(consentFor === undefined ? {} : { consentFor }),
    recordErased,
    // Ids, flags and the outcome's fixed words only: no candidate material.
    onOutcome: (job, outcome) =>
      console.info(logLine("INFO", "profile derivation finished", { ...job, ...outcome })),
  },
});
if (config.readyFile !== undefined) await writeFile(config.readyFile, `${process.pid}\n`);

let stopped = false;
const onStopped = (error?: unknown) => {
  if (stopped) return;
  stopped = true;
  if (error !== undefined) {
    console.error(logLine("ERROR", "worker stopped with an error", { err: errorFields(error) }));
  }
  void tenancy
    .close()
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
