import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  initializeCandidateKnowledgeStore,
  openCandidateKnowledgeStore,
  restoreCandidateKnowledgePortableBackup,
} from "./knowledge-store.js";

const storedAt = Date.parse("2026-10-14T09:00:00.000Z");

describe("portable backup timestamps across a backward wall-clock step", () => {
  let parent: string;

  beforeEach(async () => {
    parent = await mkdtemp(join(tmpdir(), "draft-loop-portable-backup-clock-"));
  });

  afterEach(async () => {
    vi.useRealTimers();
    await rm(parent, { recursive: true, force: true });
  });

  async function initializeStore(root: string, descriptorAt = storedAt): Promise<void> {
    const createdAt = new Date(storedAt).toISOString();
    const store = await initializeCandidateKnowledgeStore({
      root,
      descriptor: {
        schemaVersion: 1,
        id: "knowledge-store-clock",
        createdAt: new Date(descriptorAt).toISOString(),
      },
      defaultKnowledgeBase: { id: "ckb-default", displayName: "Career evidence", createdAt },
    });
    await store.close();
  }

  it("exports and restores records stamped moments before the clock stepped back", async () => {
    const root = join(parent, "store");
    await initializeStore(root);
    // WSL2 and NTP corrections can step the wall clock back by about a second.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(storedAt - 1_500);

    const store = await openCandidateKnowledgeStore(root);
    const backup = join(parent, "backup");
    try {
      await store.exportPortableBackup(backup, { createdAt: new Date(storedAt).toISOString() });
    } finally {
      await store.close();
    }
    await expect(
      restoreCandidateKnowledgePortableBackup(backup, join(parent, "restored")),
    ).resolves.toMatchObject({ status: "restored", storeId: "knowledge-store-clock" });
  });

  it("exports at the current clock while stored records are slightly ahead of it", async () => {
    const root = join(parent, "store");
    await initializeStore(root, storedAt - 60_000);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(storedAt - 1_500);

    const store = await openCandidateKnowledgeStore(root);
    try {
      await expect(store.exportPortableBackup(join(parent, "backup"))).resolves.toBeDefined();
    } finally {
      await store.close();
    }
  });

  it("still rejects backups dated beyond the clock-skew tolerance", async () => {
    const root = join(parent, "store");
    await initializeStore(root);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(storedAt);

    const store = await openCandidateKnowledgeStore(root);
    try {
      await expect(
        store.exportPortableBackup(join(parent, "future-backup"), {
          createdAt: new Date(storedAt + 10 * 60_000).toISOString(),
        }),
      ).rejects.toThrow(/invalid or in the future/i);
    } finally {
      await store.close();
    }

    const backup = join(parent, "backup");
    const reopened = await openCandidateKnowledgeStore(root);
    try {
      await reopened.exportPortableBackup(backup, { createdAt: new Date(storedAt).toISOString() });
    } finally {
      await reopened.close();
    }
    vi.setSystemTime(storedAt - 10 * 60_000);
    await expect(
      restoreCandidateKnowledgePortableBackup(backup, join(parent, "restored")),
    ).rejects.toThrow(/invalid or incomplete/i);
  });
});
