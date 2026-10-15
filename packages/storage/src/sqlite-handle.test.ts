import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadSqlite, setSqliteCommitSyncSkippedForTests } from "./sqlite-handle.js";

describe("opening a SQLite handle", () => {
  const directories: string[] = [];

  afterEach(async () => {
    setSqliteCommitSyncSkippedForTests(false);
    await Promise.all(
      directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  async function synchronousLevel(): Promise<unknown> {
    const directory = await mkdtemp(join(tmpdir(), "draft-loop-sqlite-handle-"));
    directories.push(directory);
    const handle = loadSqlite(join(directory, "history.sqlite"));
    try {
      return handle.pragma("synchronous");
    } finally {
      handle.close();
    }
  }

  it("syncs every commit to disk unless a test opts out", async () => {
    // SQLite reports FULL as 2 and OFF as 0.
    expect(await synchronousLevel()).toEqual([{ synchronous: 2 }]);

    expect(setSqliteCommitSyncSkippedForTests(true)).toBe(false);
    expect(await synchronousLevel()).toEqual([{ synchronous: 0 }]);

    expect(setSqliteCommitSyncSkippedForTests(false)).toBe(true);
    expect(await synchronousLevel()).toEqual([{ synchronous: 2 }]);
  });
});
