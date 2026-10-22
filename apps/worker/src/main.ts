import { writeFile } from "node:fs/promises";
import process from "node:process";
import { createApplicationService, createHostedApplicationDriver } from "@draft-loop/application";
import { createGcsBlobStorage } from "@draft-loop/storage-gcs";
import {
  hostedApplicationPorts,
  hostedWorkspaceReference,
  openPostgresStorage,
  startConfiguredCloudSqlProxy,
} from "@draft-loop/storage-postgres";
import { Storage } from "@google-cloud/storage";

import { readWorkerConfig } from "./config.js";
import { errorFields, logLine, runOutcomeFields } from "./logging.js";
import { workerProviderOptions } from "./model-routes.js";
import { startWorker, stopOnSignals, stopWhenIdle } from "./worker.js";

// The worker's entry point: one tenant's storage, bucket and queue, composed at startup.
const config = readWorkerConfig(process.env);
const { tenantId } = config;
// On Cloud Run, the database URL names the connector's socket and the worker signs in as its
// service identity; elsewhere this does nothing.
const cloudSql = await startConfiguredCloudSqlProxy(process.env, "iam");
const storage = await openPostgresStorage({
  connectionString: config.databaseUrl,
  schema: config.databaseSchema,
  tenantId,
});
const bucket = new Storage(
  config.gcsEndpoint === undefined
    ? {}
    : { apiEndpoint: config.gcsEndpoint, projectId: "draft-loop-local" },
).bucket(config.blobBucket);
const service = createApplicationService(
  createHostedApplicationDriver({
    ...hostedApplicationPorts({
      storage,
      tenantId,
      blobs: createGcsBlobStorage({ bucket, tenantId }),
    }),
    // Claude on Vertex AI and OpenAI's EU endpoint, keys from Secret Manager; none on the stack.
    local: workerProviderOptions(config.modelGateway),
  }),
);

const worker = await startWorker({
  queue: {
    connectionString: config.databaseUrl,
    schema: config.queueSchema,
    onError: (error) =>
      console.error(logLine("ERROR", "run queue error", { err: errorFields(error) })),
  },
  runs: {
    service,
    workspaceRoot: (job) => {
      if (job.tenantId !== tenantId) {
        throw new Error("This worker serves one tenant; the job names another.");
      }
      return hostedWorkspaceReference(job.tenantId, job.workspaceId);
    },
    allowProviderData: config.allowProviderData,
    budgetCeiling: config.budgetCeiling,
    onOutcome: (job, outcome, run) =>
      console.info(logLine("INFO", "run job finished", runOutcomeFields(job, outcome, run))),
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
  void storage
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
