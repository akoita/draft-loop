// Downloads the pinned cross-encoder's files into a directory and verifies each against the
// manifest's size and SHA-256 (#3020): `node scripts/download-reranker-model.mjs <directory>`.
// The retrieval evaluation workflow uses it; no run uses the cross-encoder yet.
import console from "node:console";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import process from "node:process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { URL } from "node:url";

const { bgeRerankerV2M3, crossEncoderModelFiles } = await import(
  new URL("../packages/embeddings/src/reranker-manifest.ts", import.meta.url).href
);

const destination = process.argv[2];
if (destination === undefined) {
  console.error("Usage: download-reranker-model.mjs <directory>");
  process.exit(2);
}

async function sha256(path) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

const model = bgeRerankerV2M3;
for (const file of crossEncoderModelFiles(model)) {
  const url = `https://huggingface.co/${model.sourceRepository}/resolve/${model.revision}/${file.path}`;
  const response = await globalThis.fetch(url, { redirect: "follow" });
  if (!response.ok || response.body === null) {
    console.error(`Downloading ${file.path} failed with HTTP ${response.status}.`);
    process.exit(1);
  }
  const path = join(destination, file.path);
  await mkdir(dirname(path), { recursive: true });
  await pipeline(Readable.fromWeb(response.body), createWriteStream(path));
  const { size } = await stat(path);
  const digest = await sha256(path);
  if (size !== file.sizeBytes || digest !== file.sha256) {
    console.error(`${file.path} does not match the manifest (${size} bytes, sha256 ${digest}).`);
    process.exit(1);
  }
  console.info(`${file.path}: verified`);
}
