import process from "node:process";

import { readRunBudgetCeiling } from "@draft-loop/application";
import { startConfiguredCloudSqlProxy } from "@draft-loop/storage-postgres";

import { buildApi } from "./app.js";
import { readApiConfig, readHostedStorageConfig } from "./config.js";
import { openHostedApplication } from "./hosted-application.js";

const config = readApiConfig(process.env);
// On Cloud Run, the database URL names the connector's socket and the API signs in as its service
// identity; elsewhere this does nothing.
const cloudSql = await startConfiguredCloudSqlProxy(process.env, "iam");
const hosted = await openHostedApplication(
  readHostedStorageConfig(process.env),
  readRunBudgetCeiling(process.env),
);
const app = await buildApi({
  ownerToken: config.ownerToken,
  logger: true,
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
