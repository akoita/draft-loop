import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { BlobStoragePort } from "../ports/blobs.js";
import { blobStorageContracts } from "./blobs.js";

/**
 * A plausible but careless in-memory store: it addresses blobs by location only, so it reads,
 * reports and deletes whatever is there now. Every port method exists, so only the contracts can
 * catch it.
 */
function locationOnlyBlobStorage(): BlobStoragePort {
  const objects = new Map<string, Uint8Array>();
  return {
    put: async (location, content) => {
      objects.set(location, content);
      const checksum = createHash("sha256").update(content).digest("hex");
      return { location, checksum, sizeBytes: content.byteLength };
    },
    get: async (reference) => objects.get(reference.location),
    exists: async (reference) => objects.has(reference.location),
    delete: async (reference) => objects.delete(reference.location),
  };
}

describe("blob conformance contracts", () => {
  it("fail a store that ignores the referenced content", async () => {
    const failed: string[] = [];
    for (const contract of blobStorageContracts) {
      try {
        await contract.check({ blobs: locationOnlyBlobStorage(), locate: (name) => name });
      } catch {
        failed.push(contract.name);
      }
    }
    expect(failed).toEqual([
      "blobs: put replaces the content and the old reference stops matching",
      "blobs: a reference with another checksum or size never matches",
      "blobs: delete removes only the referenced content, once",
    ]);
  });
});
