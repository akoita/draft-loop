import { readdir, rm, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { inflateRawSync } from "node:zlib";
import type { BlobStoragePort } from "@draft-loop/storage";
import type { BlobErasure } from "@draft-loop/storage/record-erasure";
import type { FastifyInstance } from "fastify";

/** The runtime role the Postgres flow tests connect as, with no superuser rights. */
export const runtimeRole = "draft_loop_test_app";

export function runtimeUrl(url: string): string {
  const parsed = new URL(url);
  parsed.username = runtimeRole;
  parsed.password = runtimeRole;
  return parsed.toString();
}

/**
 * Filesystem blobs that also take the tenant's relative keys, as Cloud Storage does, by placing
 * them under `root`; references keep the key the caller gave.
 */
export function tenantKeyBlobs(root: string, blobs: BlobStoragePort): BlobStoragePort {
  const path = (location: string) => (isAbsolute(location) ? location : join(root, location));
  return {
    put: async (location, content) => ({
      ...(await blobs.put(path(location), content)),
      location,
    }),
    get: (reference) => blobs.get({ ...reference, location: path(reference.location) }),
    exists: (reference) => blobs.exists({ ...reference, location: path(reference.location) }),
    delete: (reference) => blobs.delete({ ...reference, location: path(reference.location) }),
  };
}

/** Every file under a directory, as keys relative to `root`, sorted; none when it is missing. */
export async function filesUnder(root: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(join(root, prefix), { recursive: true, withFileTypes: true }).catch(
    () => [],
  );
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(root.length + 1))
    .sort();
}

/**
 * Erasure over the files `tenantKeyBlobs` writes under `root`, as the Cloud Storage adapter does it
 * in a bucket: by key, and every key under a prefix, refusing another tenant's keys.
 */
export function filesystemBlobErasure(root: string, tenantId: string): BlobErasure {
  const own = (key: string) => {
    if (!key.startsWith(`tenants/${tenantId}/`) || key.includes(".."))
      throw new Error("The key is outside the tenant's prefix.");
    return join(root, key);
  };
  return {
    removeObject: async (key) => {
      const path = own(key);
      const found = await stat(path).then(
        (entry) => entry.isFile(),
        () => false,
      );
      if (found) await rm(path);
      return found;
    },
    removePrefix: async (keyPrefix) => {
      if (!keyPrefix.endsWith("/")) throw new Error("A prefix ends in `/`.");
      own(keyPrefix);
      const removed = await filesUnder(root, keyPrefix);
      await rm(join(root, keyPrefix), { recursive: true, force: true });
      return removed.length;
    },
  };
}

/** `fetch` over the API in process, so the web client sends exactly what a browser would. */
export function injectFetch(api: FastifyInstance): typeof fetch {
  return async (input, init = {}) => {
    const url = new URL(String(input), "http://api.test");
    const body = init.body;
    const response = await api.inject({
      method: (init.method ?? "GET") as "GET",
      url: `${url.pathname}${url.search}`,
      headers: init.headers as Record<string, string>,
      ...(body === undefined || body === null
        ? {}
        : {
            payload:
              body instanceof Blob ? Buffer.from(await body.arrayBuffer()) : (body as string),
          }),
    });
    const headers = new Headers();
    for (const [name, value] of Object.entries(response.headers))
      if (value !== undefined) headers.set(name, String(value));
    // A 204 or 304 answer carries no body, and Response refuses one, even when empty.
    const empty = response.statusCode === 204 || response.statusCode === 304;
    return new Response(empty ? null : new Uint8Array(response.rawPayload), {
      status: response.statusCode,
      headers,
    });
  };
}

/**
 * Every entry of a whole zip by path, read through its central directory, stored or deflated:
 * enough for a test to look inside a downloaded record archive.
 */
export function readZipEntries(archive: Buffer): Map<string, Buffer> {
  const end = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error("No end of central directory.");
  const entries = new Map<string, Buffer>();
  let cursor = archive.readUInt32LE(end + 16);
  for (let index = archive.readUInt16LE(end + 10); index > 0; index -= 1) {
    if (archive.readUInt32LE(cursor) !== 0x02014b50) throw new Error("Bad central entry.");
    const method = archive.readUInt16LE(cursor + 10);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const local = archive.readUInt32LE(cursor + 42);
    const path = archive.toString("utf8", cursor + 46, cursor + 46 + nameLength);
    cursor +=
      46 + nameLength + archive.readUInt16LE(cursor + 30) + archive.readUInt16LE(cursor + 32);
    const start = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28);
    const data = archive.subarray(start, start + compressedSize);
    if (method !== 0 && method !== 8) throw new Error(`Unexpected method ${method}.`);
    entries.set(path, method === 8 ? inflateRawSync(data) : Buffer.from(data));
  }
  return entries;
}
