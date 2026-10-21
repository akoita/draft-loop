import process from "node:process";

import { buildApi } from "./app.js";
import { readApiConfig, readHostedStorageConfig } from "./config.js";
import { openHostedApplication } from "./hosted-application.js";

const config = readApiConfig(process.env);
const hosted = await openHostedApplication(readHostedStorageConfig(process.env));
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
      .then(() => process.exit(0));
  });
}

await app.listen({ host: config.host, port: config.port });
