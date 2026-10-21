import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { BlobStoragePort } from "../ports/blobs.js";
import type { StorageContract } from "./history-records.js";

/** A blob store under test and how to address it. */
export interface BlobStorageUnderTest {
  readonly blobs: BlobStoragePort;
  /**
   * A valid, unused location for `name` in this implementation: an absolute path on the
   * filesystem, an object key under the tenant's prefix in a bucket. `name` may contain `/`.
   */
  readonly locate: (name: string) => string;
}

/** An empty store for one contract, and how to release it afterwards. */
export interface OpenedBlobStorage {
  readonly storage: BlobStorageUnderTest;
  readonly close: () => Promise<void>;
}

export type BlobStorageFactory = () => Promise<OpenedBlobStorage>;

const bytes = (text: string) => new TextEncoder().encode(text);
const sha256 = (content: Uint8Array) => createHash("sha256").update(content).digest("hex");

/** Every blob contract, in a stable order. */
export const blobStorageContracts: readonly StorageContract<BlobStorageUnderTest>[] = [
  {
    name: "blobs: put returns the reference and get reads the same bytes back",
    check: async ({ blobs, locate }) => {
      const location = locate("exports/nested/cv.md");
      const reference = await blobs.put(location, bytes("# CV\n"));
      expect(reference).toEqual({ location, checksum: sha256(bytes("# CV\n")), sizeBytes: 5 });
      const content = await blobs.get(reference);
      expect(content).toBeInstanceOf(Uint8Array);
      expect(content).toEqual(new Uint8Array(bytes("# CV\n")));
      expect(await blobs.exists(reference)).toBe(true);
    },
  },
  {
    name: "blobs: keeps binary and empty content exactly",
    check: async ({ blobs, locate }) => {
      const binary = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0x80, 0x0a]);
      const binaryReference = await blobs.put(locate("cv.pdf"), binary);
      expect(await blobs.get(binaryReference)).toEqual(binary);

      const emptyReference = await blobs.put(locate("empty.txt"), new Uint8Array());
      expect(emptyReference.sizeBytes).toBe(0);
      expect(emptyReference.checksum).toBe(sha256(new Uint8Array()));
      expect(await blobs.get(emptyReference)).toEqual(new Uint8Array());
      expect(await blobs.exists(emptyReference)).toBe(true);
    },
  },
  {
    name: "blobs: put replaces the content and the old reference stops matching",
    check: async ({ blobs, locate }) => {
      const location = locate("cv.md");
      const first = await blobs.put(location, bytes("first"));
      const second = await blobs.put(location, bytes("second"));
      expect(await blobs.get(second)).toEqual(new Uint8Array(bytes("second")));
      expect(await blobs.get(first)).toBeUndefined();
      expect(await blobs.exists(first)).toBe(false);
    },
  },
  {
    name: "blobs: a reference with another checksum or size never matches",
    check: async ({ blobs, locate }) => {
      const reference = await blobs.put(locate("cv.md"), bytes("approved"));
      const otherChecksum = { ...reference, checksum: sha256(bytes("edited")) };
      const otherSize = { ...reference, sizeBytes: reference.sizeBytes + 1 };
      for (const changed of [otherChecksum, otherSize]) {
        expect(await blobs.get(changed)).toBeUndefined();
        expect(await blobs.exists(changed)).toBe(false);
        expect(await blobs.delete(changed)).toBe(false);
      }
      expect(await blobs.get(reference)).toEqual(new Uint8Array(bytes("approved")));
    },
  },
  {
    name: "blobs: a missing blob reads as undefined and does not exist",
    check: async ({ blobs, locate }) => {
      const content = bytes("never written");
      const missing = {
        location: locate("missing.md"),
        checksum: sha256(content),
        sizeBytes: content.byteLength,
      };
      expect(await blobs.get(missing)).toBeUndefined();
      expect(await blobs.exists(missing)).toBe(false);
      expect(await blobs.delete(missing)).toBe(false);
    },
  },
  {
    name: "blobs: delete removes only the referenced content, once",
    check: async ({ blobs, locate }) => {
      const location = locate("cv.md");
      const original = await blobs.put(location, bytes("original"));
      const replacement = await blobs.put(location, bytes("replacement"));
      expect(await blobs.delete(original)).toBe(false);
      expect(await blobs.get(replacement)).toEqual(new Uint8Array(bytes("replacement")));

      expect(await blobs.delete(replacement)).toBe(true);
      expect(await blobs.exists(replacement)).toBe(false);
      expect(await blobs.get(replacement)).toBeUndefined();
      expect(await blobs.delete(replacement)).toBe(false);
    },
  },
  {
    name: "blobs: locations are independent",
    check: async ({ blobs, locate }) => {
      const a = await blobs.put(locate("a/cv.md"), bytes("same"));
      const b = await blobs.put(locate("b/cv.md"), bytes("same"));
      expect(a.checksum).toBe(b.checksum);
      expect(await blobs.delete(a)).toBe(true);
      expect(await blobs.get(b)).toEqual(new Uint8Array(bytes("same")));
    },
  },
];

/** Runs every blob contract against fresh stores from `open`, one test per contract. */
export function describeBlobStorageConformance(
  implementation: string,
  open: BlobStorageFactory,
): void {
  describe(`${implementation} storage conformance: blobs`, () => {
    for (const contract of blobStorageContracts) {
      it(contract.name, async () => {
        const opened = await open();
        try {
          await contract.check(opened.storage);
        } finally {
          await opened.close();
        }
      });
    }
  });
}
