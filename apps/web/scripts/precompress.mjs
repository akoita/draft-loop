// Writes a Brotli (`.br`) and a gzip (`.gz`) copy beside each large text file of the built screen,
// so the API can send them compressed without compressing on every request.
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

const compressible = /\.(?:js|mjs|css|svg|json|txt|wasm)$/u;
/** Smaller files gain too little to be worth a second copy. */
const minimumBytes = 1024;

export async function precompress(root) {
  const written = [];
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !compressible.test(entry.name)) continue;
    const path = join(entry.parentPath, entry.name);
    const content = await readFile(path);
    if (content.byteLength < minimumBytes) continue;
    const brotli = brotliCompressSync(content, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
    });
    const gzip = gzipSync(content, { level: 9 });
    await writeFile(`${path}.br`, brotli);
    await writeFile(`${path}.gz`, gzip);
    written.push(path);
  }
  return written;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = process.argv[2] ?? "dist";
  const written = await precompress(root);
  process.stdout.write(`Precompressed ${written.length} files in ${root}.\n`);
}
