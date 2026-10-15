import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStorageRunStore } from "@draft-loop/orchestrator";
import { openSqliteStorage, SqliteStorage } from "@draft-loop/storage";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApplicationService } from "./index.js";
import { createLocalApplicationDriver } from "./local.js";
import { readRunInputs } from "./run-inputs-read.js";

describe("run inputs reader", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
  });

  async function workspace(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-run-inputs-"));
    roots.push(root);
    await mkdir(join(root, "evidence"), { recursive: true });
    await writeFile(join(root, "job.md"), "Deliver synthetic platform work.\n", "utf8");
    await writeFile(join(root, "evidence", "resume.md"), "Delivered synthetic work.\n", "utf8");
    await createLocalApplicationDriver().initialize(
      { root, jobDescription: "job.md", sources: "evidence", fixtureMode: true },
      { write: () => undefined },
    );
    return root;
  }

  /** Copies a started run as another run whose context was bound to the given references. */
  async function bindCopy(
    root: string,
    runId: string,
    copyId: string,
    {
      authorPromptVersion,
      ...references
    }: Record<string, unknown> & { authorPromptVersion?: string },
  ): Promise<void> {
    const storage = openSqliteStorage(join(root, ".draft-loop", "history.sqlite"));
    try {
      const store = createStorageRunStore(storage);
      const snapshot = await store.loadRun(runId);
      if (snapshot === undefined) throw new Error("Expected the started run.");
      const context = await storage.getContextSnapshot(snapshot.contextSnapshotId);
      if (context === undefined) throw new Error("Expected the run's context.");
      const contextId = `context-${copyId}`;
      await storage.saveContextSnapshot({
        id: contextId,
        workspaceId: context.workspaceId,
        schemaVersion: context.schemaVersion,
        createdAt: context.createdAt,
        payload: {
          ...(context.payload as object),
          id: contextId,
          ...references,
          ...(authorPromptVersion === undefined
            ? {}
            : {
                modelConfiguration: withAuthorPromptVersion(
                  (context.payload as { modelConfiguration: Record<string, unknown> })
                    .modelConfiguration,
                  authorPromptVersion,
                ),
              }),
        } as never,
      });
      await store.saveRun({ ...snapshot, runId: copyId, contextSnapshotId: contextId });
    } finally {
      await storage.close();
    }
  }

  const checksum = "a".repeat(64);

  function withAuthorPromptVersion(configuration: Record<string, unknown>, version: string) {
    return {
      ...configuration,
      author: { ...(configuration.author as object), promptTemplateVersion: version },
    };
  }

  it("reads the brief and profile a run was bound to, for the latest run and for a run by id", async () => {
    const root = await workspace();
    const service = createApplicationService(createLocalApplicationDriver());
    const raw = await service.start({ root }, { write: () => undefined });
    await bindCopy(root, raw.runId, "run-bound", {
      opportunityBriefReference: { briefId: "target-role", version: 3, checksum },
      candidateProfileReference: { profileId: "profile-1", version: 2, checksum },
    });
    await bindCopy(root, raw.runId, "run-brief-only", {
      opportunityBriefReference: { briefId: "target-role", version: 5, checksum },
    });

    const bound = {
      brief: { briefId: "target-role", version: 3 },
      profile: { profileId: "profile-1", version: 2 },
      authorDirections: true,
    };
    await expect(service.readRunInputs?.({ root, runId: "run-bound" })).resolves.toEqual(bound);
    await expect(readRunInputs({ root, runId: "run-brief-only" })).resolves.toEqual({
      brief: { briefId: "target-role", version: 5 },
      profile: null,
      authorDirections: true,
    });
    // Without a run id, the workspace's latest run is read: the one started without a brief.
    await expect(readRunInputs({ root })).resolves.toEqual({
      brief: null,
      profile: null,
      authorDirections: true,
    });
  });

  it("says whether the run's recorded author prompt can take directions", async () => {
    const root = await workspace();
    const raw = await createApplicationService(createLocalApplicationDriver()).start(
      { root },
      { write: () => undefined },
    );
    await bindCopy(root, raw.runId, "run-v8", { authorPromptVersion: "cli-author-v8" });
    await bindCopy(root, raw.runId, "run-v9", { authorPromptVersion: "cli-author-v9" });
    await bindCopy(root, raw.runId, "run-unknown", { authorPromptVersion: "cli-author-v99" });
    await expect(readRunInputs({ root, runId: "run-v8" })).resolves.toMatchObject({
      authorDirections: false,
    });
    await expect(readRunInputs({ root, runId: "run-v9" })).resolves.toMatchObject({
      authorDirections: true,
    });
    await expect(readRunInputs({ root, runId: "run-unknown" })).resolves.toMatchObject({
      authorDirections: false,
    });
  });

  it("reads null for a run started from raw job text", async () => {
    const root = await workspace();
    const service = createApplicationService(createLocalApplicationDriver());
    const raw = await service.start({ root }, { write: () => undefined });
    await expect(readRunInputs({ root, runId: raw.runId })).resolves.toEqual({
      brief: null,
      profile: null,
      authorDirections: true,
    });
    await expect(readRunInputs({ root })).resolves.toEqual({
      brief: null,
      profile: null,
      authorDirections: true,
    });
  });

  it("reads nothing for an unknown run or a workspace without history", async () => {
    const root = await workspace();
    await expect(readRunInputs({ root, runId: "run-does-not-exist" })).resolves.toBeUndefined();
    await expect(readRunInputs({ root })).resolves.toBeUndefined();
  });

  it("does not list the audit trail", async () => {
    const root = await workspace();
    const service = createApplicationService(createLocalApplicationDriver());
    const raw = await service.start({ root }, { write: () => undefined });
    const listing = vi.spyOn(SqliteStorage.prototype, "listAuditEvents");
    try {
      await readRunInputs({ root, runId: raw.runId });
      expect(listing).not.toHaveBeenCalled();
    } finally {
      listing.mockRestore();
    }
  });
});
