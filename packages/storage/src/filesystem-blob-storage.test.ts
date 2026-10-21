import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { describeBlobStorageConformance } from "./conformance/blobs.js";
import { createFilesystemBlobStorage } from "./filesystem-blob-storage.js";
import { StorageValidationError } from "./storage-errors.js";

const bytes = (text: string) => new TextEncoder().encode(text);

describeBlobStorageConformance("Filesystem", async () => {
  const directory = await mkdtemp(join(tmpdir(), "draft-loop-blobs-"));
  return {
    storage: {
      blobs: createFilesystemBlobStorage(),
      locate: (name) => join(directory, ...name.split("/")),
    },
    close: () => rm(directory, { recursive: true, force: true }),
  };
});

describe("filesystem blob storage", () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "draft-loop-blobs-"));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("writes the blob to the file at its location, creating directories", async () => {
    const blobs = createFilesystemBlobStorage();
    const location = join(directory, "exports", "nested", "cv.md");
    await blobs.put(location, bytes("# CV\n"));
    await expect(readFile(location, "utf8")).resolves.toBe("# CV\n");
  });

  it("never passes a file edited by hand for the referenced content", async () => {
    const blobs = createFilesystemBlobStorage();
    const location = join(directory, "cv.md");
    const reference = await blobs.put(location, bytes("approved"));
    await writeFile(location, "edited by hand");
    await expect(blobs.get(reference)).resolves.toBeUndefined();
    await expect(blobs.delete(reference)).resolves.toBe(false);
    await expect(readFile(location, "utf8")).resolves.toBe("edited by hand");
  });

  it("refuses relative locations", async () => {
    const blobs = createFilesystemBlobStorage();
    await expect(blobs.put("exports/cv.md", bytes("x"))).rejects.toBeInstanceOf(
      StorageValidationError,
    );
  });
});
