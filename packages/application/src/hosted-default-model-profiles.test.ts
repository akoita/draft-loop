import { describe, expect, it } from "vitest";

import type { StartRunCommand } from "./index.js";

import {
  presetProfileReferencesFor,
  withPresetModelProfiles,
} from "./hosted-default-model-profiles.js";
import { getModelProfilePreset } from "./model-profile-catalog.js";
import { defaultModelProfileRegistry } from "./model-profiles.js";
import { resolveRequestedRunModelProfiles } from "./run-model-profiles.js";

const economyModels = {
  author: { company: "anthropic", model: "claude-haiku-5-5" },
  critic: { company: "openai", model: "gpt-6-luna" },
};
const apiKeys = { anthropic: "api-key", openai: "api-key" } as const;

describe("hosted runs without named profiles", () => {
  it("bind the Economy writer's profile and its full output budget", () => {
    const economy = getModelProfilePreset("economy");
    const references = presetProfileReferencesFor(economyModels);
    expect(references).toEqual({ author: economy.author, critic: economy.critic });

    const resolved = resolveRequestedRunModelProfiles(
      references,
      defaultModelProfileRegistry,
      apiKeys,
    );
    // The adapter's 4,096-token default is what stopped the Economy writer at max_tokens.
    expect(resolved?.author.runtime.maxOutputTokens).toBeGreaterThan(4096);
    expect(resolved?.author.modelId).toBe("claude-haiku-5-5");
  });

  it("leave a pair no preset covers without profiles", () => {
    expect(
      presetProfileReferencesFor({
        author: { company: "anthropic", model: "claude-unknown" },
        critic: economyModels.critic,
      }),
    ).toBeUndefined();
  });

  it("keep profiles a run names itself", async () => {
    const named = {
      author: { id: "standard-anthropic-author", version: 2 },
      critic: { id: "standard-openai-critic", version: 2 },
    };
    const command = { root: "/tenants/t/workspaces/w", modelProfiles: named };
    const result = await withPresetModelProfiles(command, async () => economyModels);
    expect(result.modelProfiles).toBe(named);
  });

  it("fill in the preset when the run names none", async () => {
    const economy = getModelProfilePreset("economy");
    const command: StartRunCommand = { root: "/tenants/t/workspaces/w" };
    const result = await withPresetModelProfiles(command, async () => economyModels);
    expect(result.modelProfiles).toEqual({ author: economy.author, critic: economy.critic });
  });
});
