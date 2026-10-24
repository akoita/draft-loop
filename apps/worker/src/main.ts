import { writeFile } from "node:fs/promises";
import process from "node:process";
import type { RunJob } from "@draft-loop/run-queue";
import { createGcsBlobStorage } from "@draft-loop/storage-gcs";
import {
  hostedWorkspaceReference,
  openPostgresTenancy,
  startConfiguredCloudSqlProxy,
} from "@draft-loop/storage-postgres";
import { Storage } from "@google-cloud/storage";

import { readWorkerConfig } from "./config.js";
import { failedCallLines } from "./failed-call-logging.js";
import { errorFields, logLine, quarantineFields, runOutcomeFields } from "./logging.js";
import { workerProviderOptions } from "./model-routes.js";
import { tenantRunQuarantine } from "./tenant-quarantine.js";
import { tenantRecordErased, tenantRunConsent, tenantServices } from "./tenant-services.js";
import { startWorker, stopOnSignals, stopWhenIdle } from "./worker.js";

// The worker's entry point: one pool, bucket and queue opened at startup, serving every tenant.
// Each job names its tenant, and the application is composed over that tenant's view of them.
const config = readWorkerConfig(process.env);
if (config.modelGateway !== undefined) {
  // Routes that process material outside the EU are deployment choices, so each start names them.
  console.info(
    logLine("INFO", "model routes", {
      openAiEndpoint: config.modelGateway.openAiEndpoint,
      anthropicFallback: config.modelGateway.anthropicKeySecret !== undefined,
    }),
  );
}
// On Cloud Run, the database URL names the connector's socket and the worker signs in as its
// service identity; elsewhere this does nothing.
const cloudSql = await startConfiguredCloudSqlProxy(process.env, "iam");
const tenancy = await openPostgresTenancy({
  connectionString: config.databaseUrl,
  schema: config.databaseSchema,
});
const bucket = new Storage(
  config.gcsEndpoint === undefined
    ? {}
    : { apiEndpoint: config.gcsEndpoint, projectId: "draft-loop-local" },
).bucket(config.blobBucket);
const serviceFor = tenantServices({
  tenancy,
  blobsFor: (tenantId) => createGcsBlobStorage({ bucket, tenantId }),
  // Claude on Vertex AI and OpenAI's EU endpoint unless the deployment chose otherwise, keys
  // from Secret Manager; none on the stack.
  local: workerProviderOptions(config.modelGateway),
});

const workspaceRoot = (job: RunJob) => hostedWorkspaceReference(job.tenantId, job.workspaceId);

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
    // In a sign-in deployment, each job checks its record's consent again before any provider call.
    ...(config.requireConsent
      ? { consentFor: tenantRunConsent({ tenancy, serviceFor, workspaceRoot }) }
      : {}),
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
    // A job queued before its record was erased ends without touching the record.
    recordErased: tenantRecordErased({ tenancy, serviceFor, workspaceRoot }),
    onOutcome: (job, outcome, run, before) => {
      for (const line of failedCallLines(job, run, before)) console.error(line);
      console.info(logLine("INFO", "run job finished", runOutcomeFields(job, outcome, run)));
    },
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
