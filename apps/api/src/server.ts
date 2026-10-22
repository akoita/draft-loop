import process from "node:process";

import { readRunBudgetCeiling } from "@draft-loop/application";
import { startConfiguredCloudSqlProxy } from "@draft-loop/storage-postgres";

import { buildApi } from "./app.js";
import { readApiConfig, readHostedStorageConfig } from "./config.js";
import { openHostedApplication } from "./hosted-application.js";
import { cloudLoggingOptions, errorFields } from "./logging.js";
import { cloudRunJobWake, noWake } from "./worker-wake.js";

const config = readApiConfig(process.env);
// On Cloud Run, the database URL names the connector's socket and the API signs in as its service
// identity; elsewhere this does nothing.
const cloudSql = await startConfiguredCloudSqlProxy(process.env, "iam");
const hosted = await openHostedApplication(
  readHostedStorageConfig(process.env),
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
);
const app = await buildApi({
  ownerToken: config.ownerToken,
  logger: cloudLoggingOptions(),
  application: hosted.application,
});

// Cloud Run sends SIGTERM before stopping an instance; finish in-flight requests, then exit.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    void app
      .close()
      .then(() => hosted.close())
      .finally(() => cloudSql.close())
      .then(() => process.exit(0));
  });
}

await app.listen({ host: config.host, port: config.port });
