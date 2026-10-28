import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ContextSnapshot } from "@draft-loop/domain";
import { applicationModelProfilesSchema } from "@draft-loop/schemas/application";
import { openSqliteStorage } from "@draft-loop/storage";
import { afterEach, describe, expect, it } from "vitest";
import { CliUserError } from "./cli-user-error.js";
import { createApplicationService, type ModelProfileReferences } from "./index.js";
import { createLocalApplicationDriver } from "./local.js";
import {
  type RunProviderAuthModeConfiguration,
  resolveModelProfilePair,
} from "./model-profile-selection.js";
import { RunModelProfileError } from "./run-model-profiles.js";
import {
  describeModelProfileReferences,
  readWorkspaceModelProfileSelection,
  saveWorkspaceModelProfileSelection,
} from "./workspace-model-profile-selection.js";
import { withSavedModelProfiles } from "./workspace-model-profile-selection-service.js";

const apiKeyModes: RunProviderAuthModeConfiguration = { anthropic: "api-key", openai: "api-key" };

const writerHigh: ModelProfileReferences = {
  author: { id: "standard-anthropic-author", version: 1, effort: "high" },
  critic: { id: "standard-openai-critic", version: 2 },
};

describe("chosen reasoning levels", () => {
  describe("pair resolution", () => {
    it("uses a chosen level and keeps the other role's own level", () => {
      const pair = resolveModelProfilePair(writerHigh, apiKeyModes);
      expect(pair.author).toMatchObject({ id: "standard-anthropic-author", version: 1 });
      expect(pair.author.runtime.effort).toBe("high");
      expect(pair.critic.runtime.effort).toBe("low");
    });

    it("can lower a level as well as raise it", () => {
      const pair = resolveModelProfilePair(
        {
          author: { id: "standard-anthropic-author", version: 1, effort: "low" },
          critic: { id: "standard-openai-critic", version: 2, effort: "max" },
        },
        apiKeyModes,
      );
      expect([pair.author.runtime.effort, pair.critic.runtime.effort]).toEqual(["low", "max"]);
    });

    it.each([
      ["a level outside the choosable set", "none"],
      ["the profile-only default marker", "provider-default"],
      ["a non-string level", 3],
    ])("refuses %s", (_label, effort) => {
      expect(() =>
        resolveModelProfilePair(
          { ...writerHigh, author: { id: "standard-anthropic-author", version: 1, effort } },
          apiKeyModes,
        ),
      ).toThrow(RunModelProfileError);
    });

    it("refuses a level a historical profile version does not allow", () => {
      expect(() =>
        resolveModelProfilePair(
          {
            author: { id: "standard-anthropic-author", version: 1 },
            critic: { id: "standard-openai-critic", version: 1, effort: "high" },
          },
          apiKeyModes,
        ),
      ).toThrow(RunModelProfileError);
    });
  });

  describe("saved pairs", () => {
    const directories: string[] = [];

    afterEach(async () => {
      await Promise.all(
        directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
      );
    });

    async function workspace(): Promise<string> {
      const root = await mkdtemp(join(tmpdir(), "draft-loop-effort-selection-"));
      directories.push(root);
      await mkdir(join(root, "evidence"));
      await writeFile(join(root, "job.md"), "Build TypeScript tools.\n", "utf8");
      await writeFile(join(root, "evidence", "resume.md"), "Built TypeScript tools.\n", "utf8");
      await createLocalApplicationDriver().initialize(
        {
          root,
          jobDescription: "job.md",
          sources: "evidence",
          fixtureMode: true,
          authorModel: "claude-opus-5-5",
          criticModel: "gpt-6.1-sol",
        },
        { write: () => undefined },
      );
      return root;
    }

    it("saves and reads back a chosen level beside the exact reference", async () => {
      const root = await workspace();
      const saved = await saveWorkspaceModelProfileSelection(root, writerHigh);
      expect(saved.modelProfiles).toEqual(writerHigh);
      const file = JSON.parse(
        await readFile(join(root, ".draft-loop", "model-profile-selection.json"), "utf8"),
      ) as { modelProfiles: unknown };
      expect(file.modelProfiles).toEqual(writerHigh);
      expect((await readWorkspaceModelProfileSelection(root))?.modelProfiles).toEqual(writerHigh);
      expect(describeModelProfileReferences(writerHigh)).toBe(
        "author standard-anthropic-author@1 (high); critic standard-openai-critic@2",
      );
    });

    it("refuses to save a level the profile does not allow", async () => {
      const root = await workspace();
      await expect(
        saveWorkspaceModelProfileSelection(root, {
          ...writerHigh,
          author: { id: "standard-anthropic-author", version: 1, effort: "none" as never },
        }),
      ).rejects.toBeInstanceOf(CliUserError);
    });

    it("records the chosen level in the run's profile snapshot", async () => {
      const root = await workspace();
      await saveWorkspaceModelProfileSelection(root, writerHigh);
      const service = withSavedModelProfiles(
        createApplicationService(createLocalApplicationDriver()),
      );
      const run = await service.start({ root }, { write: () => undefined });
      const storage = openSqliteStorage(join(root, ".draft-loop", "history.sqlite"));
      try {
        const record = await storage.getContextSnapshot(run.contextSnapshotId);
        const context = record?.payload as unknown as ContextSnapshot;
        expect(context.modelConfiguration.author.profile?.runtime.effort).toBe("high");
        expect(context.modelConfiguration.critic.profile?.runtime.effort).toBe("low");
      } finally {
        await storage.close();
      }
    });
  });

  it("lets an application's pair carry a level and refuses an unknown one", () => {
    expect(applicationModelProfilesSchema.safeParse(writerHigh).success).toBe(true);
    expect(
      applicationModelProfilesSchema.safeParse({
        ...writerHigh,
        critic: { id: "standard-openai-critic", version: 2, effort: "none" },
      }).success,
    ).toBe(false);
  });
});
