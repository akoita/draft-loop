import process from "node:process";

import { readRunBudgetCeiling } from "@draft-loop/application";
import {
  createPostgresTenantDirectory,
  startConfiguredCloudSqlProxy,
} from "@draft-loop/storage-postgres";

import { buildApi } from "./app.js";
import { readApiConfig, readHostedStorageConfig } from "./config.js";
import { openHostedTenants } from "./hosted-application.js";
import { cloudLoggingOptions, errorFields } from "./logging.js";
import type { ApiAuthOptions } from "./request-auth.js";
import { cloudRunJobWake, noWake } from "./worker-wake.js";

const config = readApiConfig(process.env);
const storageConfig = readHostedStorageConfig(process.env, config.auth.mode);
// On Cloud Run, the database URL names the connector's socket and the API signs in as its service
// identity; elsewhere this does nothing.
const cloudSql = await startConfiguredCloudSqlProxy(process.env, "iam");
const hosted = await openHostedTenants(storageConfig, readRunBudgetCeiling(process.env), {
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
});
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
const app = await buildApi({
  ownerToken: config.ownerToken,
  auth,
  logger: cloudLoggingOptions(),
  tenants: hosted.tenants,
  ...(directory === undefined ? {} : { directory }),
  ...(config.webRoot === undefined ? {} : { webRoot: config.webRoot }),
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
