import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { modelSelectionSchema } from "@draft-loop/schemas";
import { expect, it } from "vitest";
import { openSqliteStorage } from "./index.js";

it("preserves profile and legacy selections through SQLite close and reopen", async () => {
  const directory = await mkdtemp(join(tmpdir(), "draft-loop-profile-"));
  const filename = join(directory, "history.sqlite");
  const createdAt = "2026-09-30T00:00:00.000Z";
  const legacy = {
    company: "anthropic",
    modelId: "fictional-exact-model",
    role: "author",
    promptTemplateVersion: "author-v3",
  };
  const selected = {
    ...legacy,
    profile: {
      id: "fictional-profile",
      version: 2,
      provider: "anthropic",
      modelId: legacy.modelId,
      tier: "standard",
      roles: ["author"],
      runtime: {
        effort: "medium",
        maxOutputTokens: 4000,
        thinking: { mode: "budgeted", maxTokens: 1000 },
      },
      knownLimits: { maxOutputTokens: 8000 },
    },
  };
  let storage = openSqliteStorage(filename);
  try {
    await storage.saveWorkspace({
      id: "workspace",
      state: "collecting",
      createdAt,
      updatedAt: createdAt,
    });
    for (const [id, selection] of [
      ["profile", selected],
      ["legacy", legacy],
    ] as const) {
      await storage.saveContextSnapshot({
        id,
        workspaceId: "workspace",
        schemaVersion: 1,
        createdAt,
        payload: { modelConfiguration: { author: selection } },
      });
    }
    storage.close();
    storage = openSqliteStorage(filename);
    for (const [id, selection] of [
      ["profile", selected],
      ["legacy", legacy],
    ] as const) {
      const restored = await storage.getContextSnapshot(id);
      const payload = restored?.payload as { modelConfiguration: { author: unknown } };
      expect(modelSelectionSchema.parse(payload.modelConfiguration.author)).toEqual(selection);
    }
  } finally {
    storage.close();
    await rm(directory, { recursive: true, force: true });
  }
});
