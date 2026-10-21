import process from "node:process";

import { buildApi } from "./app.js";
import { readApiConfig } from "./config.js";

const config = readApiConfig(process.env);
const app = await buildApi({ ownerToken: config.ownerToken, logger: true });

// Cloud Run sends SIGTERM before stopping an instance; finish in-flight requests, then exit.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}

await app.listen({ host: config.host, port: config.port });
