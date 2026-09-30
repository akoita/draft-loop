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
  it("lists only active curated profiles with bounded API price scope and explicit status", () => {
    const catalog = listModelProfileCatalog();
    const byId = new Map(
      catalog.map((entry) => [`${entry.profile.id}@${entry.profile.version}`, entry]),
    );

    expect(catalog.map(({ profile }) => `${profile.id}@${profile.version}`)).toEqual([
      "economy-anthropic-author@1",
      "economy-openai-critic@1",
      "standard-anthropic-author@1",
      "standard-openai-critic@2",
    ]);
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
          `${profile.id}@${profile.version}`,
          [apiPricing.inputUsdPerMillion, apiPricing.outputUsdPerMillion],
        ]),
      ),
    ).toEqual({
      "economy-anthropic-author@1": [2, 10],
      "economy-openai-critic@1": [0.1, 0.5],
      "standard-anthropic-author@1": [4, 20],
      "standard-openai-critic@2": [2, 10],
    });
    expect(byId.get("economy-anthropic-author@1")?.sources).toEqual([
      "https://platform.claude.com/docs/en/models/sonnet-5-5/overview",
    ]);
    expect(byId.get("standard-anthropic-author@1")?.sources).toEqual([
      "https://platform.claude.com/docs/en/models/overview",
    ]);
    expect(byId.get("standard-openai-critic@2")?.sources).toEqual([
      "https://developers.openai.com/api/docs/models/gpt-6.1-sol",
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
    expect(next).toHaveLength(4);
    expect(next[0]).toMatchObject({
      profile: {
        id: "economy-anthropic-author",
        roles: ["author"],
        modelId: "claude-sonnet-5-5",
        runtime: { thinking: { mode: "provider-default" } },
      },
      sources: ["https://platform.claude.com/docs/en/models/sonnet-5-5/overview"],
      apiPricing: { inputUsdPerMillion: 2, outputUsdPerMillion: 10 },
    });
    expect(
      defaultModelProfileRegistry.resolve("legacy-anthropic-author", 1, "author").roles,
    ).toEqual(["author"]);
  });

  it("lists only economy and standard exact, role-safe presets", () => {
    const presets = listModelProfilePresets();

    expect(presets).toEqual([
      {
        id: "economy",
        label: "Economy — unvalidated",
        tier: "economy",
        author: { id: "economy-anthropic-author", version: 1 },
        critic: { id: "economy-openai-critic", version: 1 },
      },
      {
        id: "standard",
        label: "Standard — unvalidated",
        tier: "standard",
        author: { id: "standard-anthropic-author", version: 1 },
        critic: { id: "standard-openai-critic", version: 2 },
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
    ).toBe("gpt-6-luna");

    const mutable = getModelProfilePreset("economy");
    (mutable.author as { id: string }).id = "modified";
    expect(getModelProfilePreset("economy").author.id).toBe("economy-anthropic-author");
  });

  it("keeps retired exact versions resolvable without listing them as current profiles", () => {
    expect(
      defaultModelProfileRegistry.resolve("legacy-anthropic-author", 1, "author").modelId,
    ).toBe("claude-sonnet-4-5");
    expect(defaultModelProfileRegistry.resolve("standard-openai-critic", 1, "critic").modelId).toBe(
      "gpt-6-sol",
    );
    expect(
      listModelProfileCatalog().some(({ profile }) => profile.id === "legacy-anthropic-author"),
    ).toBe(false);
    expect(
      listModelProfileCatalog().some(({ profile }) => profile.id === "premium-openai-critic"),
    ).toBe(false);
    expect(() => getModelProfilePreset("premium")).toThrowError(
      new ModelProfileCatalogError("unknown-preset"),
    );
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
