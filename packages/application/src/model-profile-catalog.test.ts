import type { AgentRole } from "@draft-loop/domain";
import { describe, expect, it } from "vitest";
import {
  getModelProfilePreset,
  listModelProfileCatalog,
  listModelProfilePresets,
  ModelProfileCatalogError,
} from "./model-profile-catalog.js";
import { defaultModelProfileRegistry } from "./model-profiles.js";

describe("model profile catalog", () => {
  it("documents all registered profiles with bounded API price scope and explicit status", () => {
    const catalog = listModelProfileCatalog();
    const byId = new Map(catalog.map((entry) => [entry.profile.id, entry]));

    expect(catalog).toHaveLength(7);
    for (const entry of catalog) {
      expect(entry).toMatchObject({
        reviewedAt: "2026-09-30",
        qualityStatus: "unvalidated",
        availabilityStatus: "not-checked",
        apiPricing: {
          maxInputTokens: 200000,
          scope: "standard-uncached-text-api",
        },
      });
      expect(entry.sources.length).toBeGreaterThan(0);
      expect(entry.sources.every((source) => source.startsWith("https://"))).toBe(true);
    }

    expect(
      Object.fromEntries(
        catalog.map(({ profile, apiPricing }) => [
          profile.id,
          [apiPricing.inputUsdPerMillion, apiPricing.outputUsdPerMillion],
        ]),
      ),
    ).toEqual({
      "legacy-anthropic-author": [3, 15],
      "legacy-openai-critic": [0.2, 1.2],
      "standard-anthropic-author": [4, 20],
      "standard-openai-critic": [2, 10],
      "premium-anthropic-author": [10, 50],
      "premium-openai-critic": [10, 50],
      "economy-openai-critic": [0.1, 0.5],
    });
    expect(byId.get("legacy-anthropic-author")?.sources).toEqual([
      "https://platform.claude.com/docs/fr/models/sonnet-4-5/overview",
      "https://platform.claude.com/docs/en/about-claude/pricing",
    ]);
    expect(byId.get("standard-anthropic-author")?.sources).toEqual([
      "https://platform.claude.com/docs/en/models/overview",
    ]);
    expect(byId.get("premium-openai-critic")?.sources).toEqual([
      "https://developers.openai.com/api/docs/models/gpt-6-astra",
    ]);
  });

  it("returns detached catalog, nested metadata, and profile snapshots", () => {
    const catalog = listModelProfileCatalog();
    const first = catalog[0];
    if (first === undefined) throw new Error("Expected catalog entries.");

    (first.profile.roles as AgentRole[]).push("critic");
    (first.profile.runtime.thinking as unknown as { maxTokens: number }).maxTokens = 1;
    (first.sources as string[])[0] = "https://untrusted.invalid/changed";
    (first.apiPricing as { inputUsdPerMillion: number }).inputUsdPerMillion = 999;
    catalog.pop();

    const next = listModelProfileCatalog();
    expect(next).toHaveLength(7);
    expect(next[0]).toMatchObject({
      profile: {
        id: "legacy-anthropic-author",
        roles: ["author"],
        runtime: { thinking: { mode: "budgeted", maxTokens: 16384 } },
      },
      sources: [
        "https://platform.claude.com/docs/fr/models/sonnet-4-5/overview",
        "https://platform.claude.com/docs/en/about-claude/pricing",
      ],
      apiPricing: { inputUsdPerMillion: 3, outputUsdPerMillion: 15 },
    });
    expect(
      defaultModelProfileRegistry.resolve("legacy-anthropic-author", 1, "author").roles,
    ).toEqual(["author"]);
  });

  it("lists only exact, role-safe pair presets and keeps frontier tiers opt-in", () => {
    const presets = listModelProfilePresets();

    expect(presets).toEqual([
      {
        id: "economy",
        label: "Economy — current defaults",
        tier: "economy",
        author: { id: "legacy-anthropic-author", version: 1 },
        critic: { id: "legacy-openai-critic", version: 1 },
      },
      {
        id: "standard",
        label: "Standard — unvalidated",
        tier: "standard",
        author: { id: "standard-anthropic-author", version: 1 },
        critic: { id: "standard-openai-critic", version: 1 },
      },
      {
        id: "premium",
        label: "Premium — unvalidated",
        tier: "premium",
        author: { id: "premium-anthropic-author", version: 1 },
        critic: { id: "premium-openai-critic", version: 1 },
      },
    ]);
    for (const preset of presets) {
      expect(
        defaultModelProfileRegistry.resolve(preset.author.id, preset.author.version, "author")
          .roles,
      ).toContain("author");
      expect(
        defaultModelProfileRegistry.resolve(preset.critic.id, preset.critic.version, "critic")
          .roles,
      ).toContain("critic");
    }
    expect(
      defaultModelProfileRegistry.resolve(getModelProfilePreset("economy").critic.id, 1, "critic")
        .modelId,
    ).toBe("gpt-5.6-luna");

    const mutable = getModelProfilePreset("premium");
    (mutable.author as { id: string }).id = "modified";
    expect(getModelProfilePreset("premium").author.id).toBe("premium-anthropic-author");
  });

  it("rejects unknown preset ids with fixed, non-echoing errors", () => {
    expect(() => getModelProfilePreset("private-preset-name")).toThrowError(
      new ModelProfileCatalogError("unknown-preset"),
    );
    try {
      getModelProfilePreset("private-preset-name");
    } catch (error) {
      expect((error as Error).message).not.toContain("private-preset-name");
    }
  });
});
