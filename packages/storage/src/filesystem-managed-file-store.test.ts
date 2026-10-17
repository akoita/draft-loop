import { createHash } from "node:crypto";
import { link, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createFilesystemManagedFileStore } from "./filesystem-managed-file-store.js";
import { managedVersionPath } from "./managed-file-io.js";
import type { StagedManagedFile } from "./ports/managed-files.js";
import { StorageConflictError, StorageValidationError } from "./storage-errors.js";

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

  describe("publication", () => {
    const fresh = { sourceId: "source-2", versionId: "version-1" };
    const stage = async (text = content): Promise<StagedManagedFile> => {
      const location = join(root, "sources", ".intake-test");
      await writeFile(location, text);
      const details = await stat(location);
      return {
        checksum: createHash("sha256").update(text).digest("hex"),
        sizeBytes: Buffer.byteLength(text),
        location,
        identity: { dev: details.dev, ino: details.ino },
      };
    };

    it("publishes staged bytes under a new key and reads them back", async () => {
      const files = createFilesystemManagedFileStore(root);
      const staged = await stage();
      await expect(files.ensureSource(fresh.sourceId)).resolves.toEqual({ created: true });
      await expect(files.ensureSource(fresh.sourceId)).resolves.toEqual({ created: false });
      await files.publish(staged, fresh);
      expect(new TextDecoder().decode(await files.read(fresh, staged))).toBe(content);
      await expect(files.removeStaged(staged)).resolves.toBe(true);
      await expect(files.read(fresh, staged)).resolves.toBeInstanceOf(Uint8Array);
    });

    it("never replaces a file already published under the key", async () => {
      await writeFile(path, content);
      const files = createFilesystemManagedFileStore(root);
      const staged = await stage("Different bytes entirely.\n");
      await expect(files.publish(staged, key)).rejects.toThrow(StorageConflictError);
      await expect(readFile(path, "utf8")).resolves.toBe(content);
    });

    it("refuses to remove staged bytes that were replaced by another file", async () => {
      const files = createFilesystemManagedFileStore(root);
      const staged = await stage();
      // Keep the original inode allocated so the replacement cannot reuse it.
      await link(staged.location, join(root, "original"));
      await rm(staged.location);
      await writeFile(staged.location, content);
      await expect(files.removeStaged(staged)).resolves.toBe(false);
      await expect(readFile(staged.location, "utf8")).resolves.toBe(content);
    });

    it("rolls back an uncommitted write, including the source location it created", async () => {
      const files = createFilesystemManagedFileStore(root);
      const staged = await stage();
      const { created } = await files.ensureSource(fresh.sourceId);
      await files.publish(staged, fresh);
      await expect(
        files.discardUncommitted(staged, {
          target: fresh,
          published: true,
          createdSource: created,
        }),
      ).resolves.toBe(true);
      await expect(files.verify(fresh, staged)).rejects.toThrow(/is missing/);
      await expect(stat(staged.location)).rejects.toThrow();
      await expect(
        stat(join(managedVersionPath(root, fresh.sourceId, fresh.versionId), "..")),
      ).rejects.toThrow();
    });
  });
});
