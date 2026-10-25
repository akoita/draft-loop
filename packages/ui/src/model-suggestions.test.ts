import {
  createModelProfileRegistry,
  defaultModelProfileRegistry,
} from "@draft-loop/application/model-profiles";

import type { ModelProfile } from "@draft-loop/domain/model-profile";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  hasFallbackModelSuggestions,
  ModelSuggestionDatalist,
  projectModelSuggestions,
} from "./model-suggestions.js";

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

    expect(authorSuggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          modelId: "claude-sonnet-4-5",
          tiers: ["economy"],
          roles: ["author"],
          registeredForRole: true,
          label: "Economy tier · Author profile · registered for Author",
        }),
        expect.objectContaining({ modelId: "claude-opus-5-5", roles: ["author"] }),
        expect.objectContaining({ modelId: "claude-fable-5-1", roles: ["author"] }),
      ]),
    );
    expect(authorSuggestions.every(({ modelId }) => !modelId.startsWith("gpt-"))).toBe(true);
    expect(criticSuggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          modelId: "gpt-5.6-luna",
          tiers: ["economy"],
          roles: ["critic"],
          registeredForRole: true,
        }),
        expect.objectContaining({ modelId: "gpt-6-sol", roles: ["critic"] }),
        expect.objectContaining({ modelId: "gpt-6-astra", roles: ["critic"] }),
        expect.objectContaining({ modelId: "gpt-6-luna", roles: ["critic"] }),
      ]),
    );
    const gptLunaWrongRole = wrongRole.find(({ modelId }) => modelId === "gpt-5.6-luna");
    expect(gptLunaWrongRole).toMatchObject({
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

  it("limits fallback datalists to the active catalog while keeping IDs free to type", () => {
    const anthropic = renderToStaticMarkup(
      createElement(ModelSuggestionDatalist, {
        id: "author-models",
        company: "anthropic",
        role: "author",
      }),
    );
    const openai = renderToStaticMarkup(
      createElement(ModelSuggestionDatalist, {
        id: "critic-models",
        company: "openai",
        role: "critic",
      }),
    );

    expect(anthropic).toContain('value="claude-haiku-5-5"');
    expect(anthropic).toContain('value="claude-opus-5-5"');
    expect(anthropic).not.toContain('value="claude-sonnet-4-5"');
    expect(anthropic).not.toContain('value="claude-fable-5-1"');
    expect(openai).toContain('value="gpt-6-luna"');
    expect(openai).toContain('value="gpt-6.1-sol"');
    expect(openai).not.toContain('value="gpt-5.6-luna"');
    expect(openai).not.toContain('value="gpt-6-sol"');
    expect(anthropic).toContain("Author profile · registered for Author");
    expect(openai).toContain("Critic profile · registered for Critic");
  });
});
