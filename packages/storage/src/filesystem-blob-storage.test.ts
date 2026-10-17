import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createFilesystemBlobStorage } from "./filesystem-blob-storage.js";
import { StorageValidationError } from "./storage-errors.js";

const bytes = (text: string) => new TextEncoder().encode(text);

describe("filesystem blob storage", () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "draft-loop-blobs-"));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("writes a blob at its location, creating directories, and reads it back", async () => {
    const blobs = createFilesystemBlobStorage();
    const location = join(directory, "exports", "nested", "cv.md");
    const reference = await blobs.put(location, bytes("# CV\n"));
    expect(reference).toEqual({
      location,
      checksum: createHash("sha256").update("# CV\n").digest("hex"),
      sizeBytes: 5,
    });
    await expect(readFile(location, "utf8")).resolves.toBe("# CV\n");
    await expect(blobs.get(reference)).resolves.toEqual(new Uint8Array(bytes("# CV\n")));
    await expect(blobs.exists(reference)).resolves.toBe(true);
  });

  it("replaces what was at the location", async () => {
    const blobs = createFilesystemBlobStorage();
    const location = join(directory, "cv.md");
    const first = await blobs.put(location, bytes("first"));
    const second = await blobs.put(location, bytes("second"));
    await expect(blobs.get(second)).resolves.toEqual(new Uint8Array(bytes("second")));
    await expect(blobs.get(first)).resolves.toBeUndefined();
    await expect(blobs.exists(first)).resolves.toBe(false);
  });

  it("never passes a missing or changed file for the referenced content", async () => {
    const blobs = createFilesystemBlobStorage();
    const location = join(directory, "cv.md");
    const reference = await blobs.put(location, bytes("approved"));
    await writeFile(location, "edited by hand");
    await expect(blobs.get(reference)).resolves.toBeUndefined();
    await expect(blobs.delete(reference)).resolves.toBe(false);
    await expect(readFile(location, "utf8")).resolves.toBe("edited by hand");
    await expect(
      blobs.exists({ ...reference, location: join(directory, "missing.md") }),
    ).resolves.toBe(false);
  });

  it("deletes a blob that still holds its content", async () => {
    const blobs = createFilesystemBlobStorage();
    const reference = await blobs.put(join(directory, "cv.pdf"), bytes("%PDF"));
    await expect(blobs.delete(reference)).resolves.toBe(true);
    await expect(stat(reference.location)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(blobs.delete(reference)).resolves.toBe(false);
  });

  it("refuses relative locations", async () => {
    const blobs = createFilesystemBlobStorage();
    await expect(blobs.put("exports/cv.md", bytes("x"))).rejects.toBeInstanceOf(
      StorageValidationError,
    );
  });
});
