import process from "node:process";

import { installBakedEmbeddingModel } from "./embedding-model.js";

// The worker image's install step: `tsx src/install-embedding-model.ts <downloaded> <model root>`.
const [from, modelRoot] = process.argv.slice(2);
if (from === undefined || modelRoot === undefined) {
  console.error("Usage: install-embedding-model.ts <downloaded files> <model root>");
  process.exit(2);
}
const status = await installBakedEmbeddingModel({ from, modelRoot });
console.info(`Installed ${status.modelId} at ${status.revision} (${status.totalSizeBytes} bytes).`);
