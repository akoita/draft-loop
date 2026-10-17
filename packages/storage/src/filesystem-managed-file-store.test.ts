import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createFilesystemManagedFileStore } from "./filesystem-managed-file-store.js";
import { managedVersionPath } from "./managed-file-io.js";
import { StorageValidationError } from "./storage-errors.js";

const key = { sourceId: "source-1", versionId: "version-1" };
const content = "Led the platform migration.\n";
const integrity = {
  checksum: createHash("sha256").update(content).digest("hex"),
  sizeBytes: Buffer.byteLength(content),
};

describe("filesystem managed-file store", () => {
  let root: string;
  let path: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "draft-loop-managed-files-"));
    path = managedVersionPath(root, key.sourceId, key.versionId);
    await mkdir(join(path, ".."), { recursive: true });
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("reads and verifies a file that matches its record, in today's layout", async () => {
    await writeFile(path, content);
    const files = createFilesystemManagedFileStore(root);
    const read = await files.read(key, integrity);
    expect(new TextDecoder().decode(read)).toBe(content);
    expect(read).toBeInstanceOf(Uint8Array);
    await expect(files.verify(key, integrity)).resolves.toBeUndefined();
  });

  it("rejects content that changed without changing size", async () => {
    await writeFile(path, content.replace("Led", "Ran"));
    const files = createFilesystemManagedFileStore(root);
    await expect(files.read(key, integrity)).rejects.toThrow(StorageValidationError);
    await expect(files.verify(key, integrity)).rejects.toThrow(/checksum does not match/);
  });

  it("rejects a file whose size differs from its record", async () => {
    await writeFile(path, `${content}more`);
    const files = createFilesystemManagedFileStore(root);
    await expect(files.read(key, integrity)).rejects.toThrow(/size does not match/);
    await expect(files.verify(key, integrity)).rejects.toThrow(/size does not match/);
  });

  it("rejects a missing file", async () => {
    const files = createFilesystemManagedFileStore(root);
    await expect(files.read(key, integrity)).rejects.toThrow(/is missing/);
    await expect(files.verify(key, integrity)).rejects.toThrow(/is missing/);
  });

  it.skipIf(process.platform === "win32")("refuses to follow a symbolic link", async () => {
    const outside = join(root, "outside.txt");
    await writeFile(outside, content);
    await symlink(outside, path);
    const files = createFilesystemManagedFileStore(root);
    await expect(files.read(key, integrity)).rejects.toThrow(/not a symbolic link/);
    await expect(files.verify(key, integrity)).rejects.toThrow(/not a symbolic link/);
  });

  it("rejects invalid integrity metadata before touching the file", async () => {
    await writeFile(path, content);
    const files = createFilesystemManagedFileStore(root);
    await expect(files.read(key, { ...integrity, checksum: "not-a-checksum" })).rejects.toThrow(
      /integrity metadata is invalid/,
    );
  });
});
