import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ContextSnapshot } from "@draft-loop/domain";
import { openSqliteStorage } from "@draft-loop/storage";
import { afterEach, describe, expect, it } from "vitest";
import { CliUserError } from "./cli-user-error.js";
import { createApplicationService, type ModelProfileReferences } from "./index.js";
import { createLocalApplicationDriver } from "./local.js";
import {
  clearWorkspaceModelProfileSelection,
  readWorkspaceModelProfileSelection,
  saveWorkspaceModelProfileSelection,
  workspaceModelProfileSelectionInvalidMessage,
} from "./workspace-model-profile-selection.js";
import {
  createWorkspaceModelProfileSelectionService,
  withSavedModelProfiles,
} from "./workspace-model-profile-selection-service.js";

const pair: ModelProfileReferences = {
  author: { id: "legacy-anthropic-author", version: 1 },
  critic: { id: "legacy-openai-critic", version: 1 },
};
const otherPair: ModelProfileReferences = {
  author: { id: "standard-anthropic-author", version: 1 },
  critic: { id: "standard-openai-critic", version: 2 },
};

describe("workspace model profile selection", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
    );
  });

  async function workspace(
    models: { authorModel?: string; criticModel?: string } = {
      authorModel: "claude-sonnet-4-5",
      criticModel: "gpt-5.6-luna",
    },
  ): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-profile-selection-"));
    directories.push(root);
    await mkdir(join(root, "evidence"));
    await writeFile(join(root, "job.md"), "Build TypeScript tools.\n", "utf8");
    await writeFile(join(root, "evidence", "resume.md"), "Built TypeScript tools.\n", "utf8");
    await createLocalApplicationDriver().initialize(
      { root, jobDescription: "job.md", sources: "evidence", fixtureMode: true, ...models },
      { write: () => undefined },
    );
    return root;
  }

  const selectionPath = (root: string) => join(root, ".draft-loop", "model-profile-selection.json");

  async function contextOf(root: string, contextSnapshotId: string): Promise<ContextSnapshot> {
    const storage = openSqliteStorage(join(root, ".draft-loop", "history.sqlite"));
    try {
      const record = await storage.getContextSnapshot(contextSnapshotId);
      if (record === undefined) throw new Error("Missing context");
      return record.payload as unknown as ContextSnapshot;
    } finally {
      await storage.close();
    }
  }

  function wrapped() {
    return withSavedModelProfiles(createApplicationService(createLocalApplicationDriver()));
  }

  describe("file", () => {
    it("treats a missing file as no pair applied", async () => {
      expect(await readWorkspaceModelProfileSelection(await workspace())).toBeUndefined();
    });

    it("saves, reads back and clears an exact pair with the documented shape", async () => {
      const root = await workspace();
      const saved = await saveWorkspaceModelProfileSelection(root, pair, {
        now: () => new Date("2026-01-02T03:04:05.000Z"),
      });
      expect(saved).toEqual({ modelProfiles: pair, appliedAt: "2026-01-02T03:04:05.000Z" });
      expect(JSON.parse(await readFile(selectionPath(root), "utf8"))).toEqual({
        schemaVersion: 1,
        modelProfiles: pair,
        appliedAt: "2026-01-02T03:04:05.000Z",
      });
      expect(await readWorkspaceModelProfileSelection(root)).toEqual(saved);
      expect((await readdir(join(root, ".draft-loop"))).filter((n) => n.endsWith(".tmp"))).toEqual(
        [],
      );

      expect(await clearWorkspaceModelProfileSelection(root)).toBe(true);
      expect(await readWorkspaceModelProfileSelection(root)).toBeUndefined();
      expect(await clearWorkspaceModelProfileSelection(root)).toBe(false);
    });

    it.each([
      ["not JSON", "{"],
      [
        "an unknown key",
        JSON.stringify({
          schemaVersion: 1,
          modelProfiles: pair,
          appliedAt: "2026-01-02T03:04:05.000Z",
          extra: 1,
        }),
      ],
      [
        "a wrong version",
        JSON.stringify({
          schemaVersion: 2,
          modelProfiles: pair,
          appliedAt: "2026-01-02T03:04:05.000Z",
        }),
      ],
      [
        "a missing critic",
        JSON.stringify({
          schemaVersion: 1,
          modelProfiles: { author: pair.author },
          appliedAt: "2026-01-02T03:04:05.000Z",
        }),
      ],
      [
        "a zero version",
        JSON.stringify({
          schemaVersion: 1,
          modelProfiles: { ...pair, critic: { id: "x", version: 0 } },
          appliedAt: "2026-01-02T03:04:05.000Z",
        }),
      ],
      [
        "an extra profile key",
        JSON.stringify({
          schemaVersion: 1,
          modelProfiles: { ...pair, author: { ...pair.author, tier: "x" } },
          appliedAt: "2026-01-02T03:04:05.000Z",
        }),
      ],
      [
        "a bad timestamp",
        JSON.stringify({ schemaVersion: 1, modelProfiles: pair, appliedAt: "yesterday" }),
      ],
    ])("fails closed on %s and can still be cleared", async (_name, content) => {
      const root = await workspace();
      await writeFile(selectionPath(root), content, "utf8");
      await expect(readWorkspaceModelProfileSelection(root)).rejects.toThrow(
        workspaceModelProfileSelectionInvalidMessage,
      );
      expect(await clearWorkspaceModelProfileSelection(root)).toBe(true);
      expect(await readWorkspaceModelProfileSelection(root)).toBeUndefined();
    });

    it("refuses to save outside a workspace", async () => {
      const root = await mkdtemp(join(tmpdir(), "draft-loop-profile-selection-none-"));
      directories.push(root);
      await expect(saveWorkspaceModelProfileSelection(root, pair)).rejects.toThrow(CliUserError);
      expect(await readdir(root)).toEqual([]);
    });

    it("refuses unknown profiles and profiles that differ from the workspace models", async () => {
      const root = await workspace();
      await expect(
        saveWorkspaceModelProfileSelection(root, {
          ...pair,
          author: { id: "no-such-profile", version: 1 },
        }),
      ).rejects.toThrow(/no-such-profile@1 is not a registered author profile/u);
      await expect(
        saveWorkspaceModelProfileSelection(root, {
          ...pair,
          critic: { id: pair.author.id, version: 1 },
        }),
      ).rejects.toThrow(/not a registered critic profile/u);
      await expect(saveWorkspaceModelProfileSelection(root, otherPair)).rejects.toThrow(
        /workspace author is anthropic\/claude-sonnet-4-5|workspace critic is/u,
      );
      expect(await readWorkspaceModelProfileSelection(root)).toBeUndefined();
    });

    it("exposes the same operations through the service", async () => {
      const root = await workspace();
      const service = createWorkspaceModelProfileSelectionService();
      expect(await service.get({ root })).toBeUndefined();
      const saved = await service.save({ root, modelProfiles: pair });
      expect(await service.get({ root })).toEqual(saved);
      expect(await service.clear({ root })).toBe(true);
    });
  });

  describe("withSavedModelProfiles", () => {
    it("starts with the saved pair when no profiles are named", async () => {
      const root = await workspace();
      await saveWorkspaceModelProfileSelection(root, pair);
      const lines: string[] = [];
      const run = await wrapped().start({ root }, { write: (line) => lines.push(line) });
      const context = await contextOf(root, run.contextSnapshotId);
      expect(context.modelConfiguration.author.profile).toMatchObject(pair.author);
      expect(context.modelConfiguration.critic.profile).toMatchObject(pair.critic);
      expect(lines).toContain(
        "Model profiles: saved for this workspace (author legacy-anthropic-author@1; critic legacy-openai-critic@1).",
      );
    });

    it("lets explicit profiles win over the saved pair", async () => {
      const root = await workspace();
      await saveWorkspaceModelProfileSelection(root, pair);
      const explicit: ModelProfileReferences = {
        author: { id: "standard-anthropic-author", version: 1 },
        critic: { id: "legacy-openai-critic", version: 1 },
      };
      const lines: string[] = [];
      // The explicit author differs in profile but a fixture workspace accepts any registered one.
      const run = await wrapped().start(
        { root, modelProfiles: explicit },
        { write: (line) => lines.push(line) },
      );
      const context = await contextOf(root, run.contextSnapshotId);
      expect(context.modelConfiguration.author.profile).toMatchObject(explicit.author);
      expect(lines).toContain(
        "Model profiles: explicit (author standard-anthropic-author@1; critic legacy-openai-critic@1).",
      );
      expect(lines.join("\n")).not.toContain("saved for this workspace");
    });

    it("ignores a saved pair that no longer matches the workspace and says why", async () => {
      const root = await workspace();
      await saveWorkspaceModelProfileSelection(root, pair);
      await createLocalApplicationDriver().reconfigureModels(
        {
          root,
          authorCompany: "anthropic",
          authorModel: "claude-opus-test",
          criticCompany: "openai",
          criticModel: "gpt-5.6-luna",
        },
        { write: () => undefined },
      );
      const lines: string[] = [];
      const run = await wrapped().start({ root }, { write: (line) => lines.push(line) });
      const context = await contextOf(root, run.contextSnapshotId);
      expect(context.modelConfiguration.author.profile).toBeUndefined();
      expect(context.modelConfiguration.critic.profile).toBeUndefined();
      const text = lines.join("\n");
      expect(text).toContain(
        "the saved pair (author legacy-anthropic-author@1; critic legacy-openai-critic@1) was ignored because the author profile legacy-anthropic-author@1 is for anthropic/claude-sonnet-4-5 but the workspace author is anthropic/claude-opus-test",
      );
      expect(text).toContain(
        "legacy path: provider-default runtime controls, unknown context windows",
      );
    });

    it("states the legacy path when nothing is saved or named", async () => {
      const root = await workspace();
      const lines: string[] = [];
      const run = await wrapped().start({ root }, { write: (line) => lines.push(line) });
      const context = await contextOf(root, run.contextSnapshotId);
      expect(context.modelConfiguration.author.profile).toBeUndefined();
      expect(lines).toContain(
        "Model profiles: none attached (legacy path: provider-default runtime controls, unknown context windows).",
      );
    });

    it("stops a start before any run exists when the saved file is corrupt", async () => {
      const root = await workspace();
      await writeFile(selectionPath(root), "{", "utf8");
      await expect(wrapped().start({ root }, { write: () => undefined })).rejects.toThrow(
        workspaceModelProfileSelectionInvalidMessage,
      );
      await expect(readdir(join(root, ".draft-loop"))).resolves.not.toContain("history.sqlite");
    });

    it("does not alter resume: a resumed run keeps its own recorded profiles", async () => {
      const root = await workspace();
      await saveWorkspaceModelProfileSelection(root, pair);
      const service = wrapped();
      const run = await service.start({ root }, { write: () => undefined });
      await clearWorkspaceModelProfileSelection(root);
      await writeFile(selectionPath(root), "{", "utf8");
      const lines: string[] = [];
      const resumed = await service.resume(
        { root, runId: run.runId },
        { write: (line) => lines.push(line) },
      );
      expect(resumed.contextSnapshotId).toBe(run.contextSnapshotId);
      expect(lines.join("\n")).not.toContain("Model profiles:");
    });
  });
});
