import {
  createModelProfileRegistry,
  defaultModelProfileRegistry,
} from "@draft-loop/application/model-profiles";

import type { ModelProfile } from "@draft-loop/domain/model-profile";
import { describe, expect, it } from "vitest";
import { hasFallbackModelSuggestions, projectModelSuggestions } from "./model-suggestions.js";

describe("registered model suggestions", () => {
  it("projects the current registry by company and marks unsupported roles", () => {
    const profiles = defaultModelProfileRegistry.list();
    const authorSuggestions = projectModelSuggestions(profiles, "anthropic", "author");
    const criticSuggestions = projectModelSuggestions(
      defaultModelProfileRegistry,
      "openai",
      "critic",
    );
    const wrongRole = projectModelSuggestions(profiles, "openai", "author");

    expect(authorSuggestions).toEqual([
      expect.objectContaining({
        modelId: "claude-sonnet-4-5",
        tiers: ["economy"],
        roles: ["author"],
        registeredForRole: true,
        label: "Economy tier · Author profile · registered for Author",
      }),
    ]);
    expect(criticSuggestions).toEqual([
      expect.objectContaining({
        modelId: "gpt-5.6-luna",
        tiers: ["economy"],
        roles: ["critic"],
        registeredForRole: true,
      }),
    ]);
    expect(wrongRole[0]).toMatchObject({
      modelId: "gpt-5.6-luna",
      registeredForRole: false,
      label: "Economy tier · Critic profile · not registered for Author",
    });
    expect(projectModelSuggestions(profiles, "local", "author")).toEqual([]);
  });

  it("deduplicates an exact model id across registered versions and aggregates metadata", () => {
    const [first] = defaultModelProfileRegistry.list();
    if (first === undefined) throw new Error("The default model profile registry is empty.");
    const second: ModelProfile = {
      ...first,
      version: 2,
      tier: "standard",
      roles: ["author", "critic"],
    };
    const registry = createModelProfileRegistry([first, second]);
    const suggestions = projectModelSuggestions(registry, "anthropic", "critic");

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({
      modelId: "claude-sonnet-4-5",
      tiers: ["economy", "standard"],
      roles: ["author", "critic"],
      profileCount: 2,
      registeredForRole: true,
      label: "Economy, Standard tier · Author, Critic profiles · registered for Critic",
    });
  });

  it("offers profile suggestions only for failed or empty non-local discovery", () => {
    expect(hasFallbackModelSuggestions("anthropic", "unavailable", 0)).toBe(true);
    expect(hasFallbackModelSuggestions("openai", "ready", 0)).toBe(true);
    expect(hasFallbackModelSuggestions("anthropic", "ready", 3)).toBe(false);
    expect(hasFallbackModelSuggestions("anthropic", "loading", 0)).toBe(false);
    expect(hasFallbackModelSuggestions("local", "unavailable", 0)).toBe(false);
  });
});
