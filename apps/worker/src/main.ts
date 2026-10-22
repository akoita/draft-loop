import { writeFile } from "node:fs/promises";
import process from "node:process";
import { createApplicationService, createHostedApplicationDriver } from "@draft-loop/application";
import { createGcsBlobStorage } from "@draft-loop/storage-gcs";
import {
  hostedApplicationPorts,
  hostedWorkspaceReference,
  openPostgresStorage,
} from "@draft-loop/storage-postgres";
import { Storage } from "@google-cloud/storage";

import { readWorkerConfig } from "./config.js";
import { startWorker, stopOnSignals } from "./worker.js";

// The worker's entry point: one tenant's storage, bucket and queue, composed at startup.
const config = readWorkerConfig(process.env);
const { tenantId } = config;
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
  createHostedApplicationDriver(
    hostedApplicationPorts({
      storage,
      tenantId,
      blobs: createGcsBlobStorage({ bucket, tenantId }),
    }),
  ),
);

const worker = await startWorker({
  queue: {
    connectionString: config.databaseUrl,
    schema: config.queueSchema,
    onError: (error) => console.error("run queue error", error),
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
    onOutcome: (job, outcome) => console.info(JSON.stringify({ runId: job.runId, outcome })),
  },
});
if (config.readyFile !== undefined) await writeFile(config.readyFile, `${process.pid}\n`);

stopOnSignals(worker, {
  onStopped: (error) => {
    if (error !== undefined) console.error("worker stopped with an error", error);
    void storage.close().finally(() => process.exit(error === undefined ? 0 : 1));
  },
});
