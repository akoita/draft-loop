// Downloads the pinned default embedding model's files into a directory, for the worker image's
// own build stage: `node apps/worker/scripts/download-embedding-model.mjs <directory>`. It only
// reads the manifest, so the stage's cache survives every other change, and it checks nothing:
// the image's install step verifies each file against the manifest's size and SHA-256.
import console from "node:console";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import process from "node:process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { URL } from "node:url";

const { embeddingModelFiles, getGraniteEmbeddingModel } = await import(
  new URL("../../../packages/embeddings/src/model-manifest.ts", import.meta.url).href
);

const destination = process.argv[2];
if (destination === undefined) {
  console.error("Usage: download-embedding-model.mjs <directory>");
  process.exit(2);
}

const model = getGraniteEmbeddingModel();
for (const file of embeddingModelFiles(model)) {
  const url = `https://huggingface.co/${model.sourceRepository}/resolve/${model.revision}/${file.path}`;
  const response = await globalThis.fetch(url, { redirect: "follow" });
  if (!response.ok || response.body === null) {
    console.error(`Downloading ${file.path} failed with HTTP ${response.status}.`);
    process.exit(1);
  }
  const path = join(destination, file.path);
  await mkdir(dirname(path), { recursive: true });
  await pipeline(Readable.fromWeb(response.body), createWriteStream(path));
  console.info(`${file.path}: ${file.sizeBytes} bytes expected`);
}
