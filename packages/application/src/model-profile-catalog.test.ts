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
      "economy-anthropic-author@2",
      "economy-openai-critic@1",
      "standard-anthropic-author@1",
      "standard-openai-critic@2",
      "dev-deepinfra-glm-author@1",
      "dev-google-gemini-author@2",
      "dev-mistral-author@1",
    ]);
    for (const entry of catalog) {
      expect(entry).toMatchObject({
        qualityStatus: "unvalidated",
        availabilityStatus: "not-checked",
        apiPricing: {
          maxInputTokens:
            `${entry.profile.id}@${entry.profile.version}` === "economy-anthropic-author@2"
              ? 100000
              : 200000,
          scope: "standard-uncached-text-api",
        },
      });
      expect(entry.sources.length).toBeGreaterThan(0);
      expect(entry.sources.every((source) => source.startsWith("https://"))).toBe(true);
      const developmentReviewDates: Record<string, string> = {
        "dev-deepinfra-glm-author": "2026-10-02",
        "dev-google-gemini-author": "2026-10-04",
        "dev-mistral-author": "2026-10-08",
        "economy-anthropic-author": "2026-10-07",
      };
      expect(entry.reviewedAt).toBe(developmentReviewDates[entry.profile.id] ?? "2026-09-30");
    }

    expect(
      Object.fromEntries(
        catalog.map(({ profile, apiPricing }) => [
          `${profile.id}@${profile.version}`,
          [apiPricing.inputUsdPerMillion, apiPricing.outputUsdPerMillion],
        ]),
      ),
    ).toEqual({
      "economy-anthropic-author@2": [0.1, 0.5],
      "economy-openai-critic@1": [0.1, 0.5],
      "standard-anthropic-author@1": [4, 20],
      "standard-openai-critic@2": [2, 10],
      "dev-deepinfra-glm-author@1": [0.15, 0.5],
      "dev-google-gemini-author@2": [0.75, 3.75],
      "dev-mistral-author@1": [1.36, 4.18],
    });
    expect(byId.get("economy-anthropic-author@2")?.sources).toEqual([
      "https://platform.claude.com/docs/en/about-claude/models/overview",
    ]);
    expect(byId.get("economy-anthropic-author@1")).toBeUndefined();
    expect(
      defaultModelProfileRegistry.resolve("economy-anthropic-author", 1, "author").modelId,
    ).toBe("claude-sonnet-5-5");
    expect(byId.get("standard-anthropic-author@1")?.sources).toEqual([
      "https://platform.claude.com/docs/en/models/overview",
    ]);
    expect(byId.get("standard-openai-critic@2")?.sources).toEqual([
      "https://developers.openai.com/api/docs/models/gpt-6.1-sol",
    ]);
    expect(byId.get("dev-deepinfra-glm-author@1")?.sources).toEqual([
      "https://deepinfra.com/zai-org/GLM-5.3-Flash/api",
      "https://deepinfra.com/blog/glm-5-3-flash-deepinfra",
    ]);
    expect(byId.get("dev-google-gemini-author@2")?.sources).toEqual([
      "https://ai.google.dev/gemini-api/docs/pricing",
      "https://ai.google.dev/gemini-api/docs/models",
    ]);
    expect(byId.get("dev-google-gemini-author@2")).toMatchObject({
      profile: {
        provider: "google",
        modelId: "gemini-3.8-flash",
        roles: ["author"],
        runtime: { effort: "low", maxOutputTokens: 32768, thinking: { mode: "provider-default" } },
      },
    });
    expect(byId.get("dev-mistral-author@1")?.sources).toEqual([
      "https://docs.mistral.ai/models/mistral-large-4",
    ]);
    expect(byId.get("dev-mistral-author@1")).toMatchObject({
      profile: {
        provider: "mistral",
        modelId: "mistral-large-4",
        roles: ["author"],
        runtime: {
          effort: "provider-default",
          maxOutputTokens: 32768,
          thinking: { mode: "provider-default" },
        },
      },
      apiPricing: { maxInputTokens: 200000 },
    });
    expect(catalog.filter(({ profile }) => profile.id === "economy-openai-critic")).toHaveLength(1);
    expect(byId.get("dev-deepinfra-glm-author@1")).toMatchObject({
      profile: {
        provider: "zai",
        modelId: "zai-org/GLM-5.3-Flash",
        roles: ["author"],
        runtime: { effort: "low", maxOutputTokens: 32768, thinking: { mode: "provider-default" } },
      },
    });
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
        id: "economy-anthropic-author",
        roles: ["author"],
        version: 2,
        modelId: "claude-haiku-5-5",
        runtime: { thinking: { mode: "provider-default" } },
      },
      sources: ["https://platform.claude.com/docs/en/about-claude/models/overview"],
      apiPricing: { inputUsdPerMillion: 0.1, outputUsdPerMillion: 0.5, maxInputTokens: 100000 },
    });
    expect(
      defaultModelProfileRegistry.resolve("legacy-anthropic-author", 1, "author").roles,
    ).toEqual(["author"]);
  });

  it("lists opt-in economy, standard, and development GLM, Gemini, and Mistral exact, role-safe presets", () => {
    const presets = listModelProfilePresets();

    expect(presets).toEqual([
      {
        id: "economy",
        label: "Economy — unvalidated",
        tier: "economy",
        author: { id: "economy-anthropic-author", version: 2 },
        critic: { id: "economy-openai-critic", version: 1 },
      },
      {
        id: "standard",
        label: "Standard — unvalidated",
        tier: "standard",
        author: { id: "standard-anthropic-author", version: 1 },
        critic: { id: "standard-openai-critic", version: 2 },
      },
      {
        id: "development-glm",
        label: "Development — GLM Flash — unvalidated",
        tier: "economy",
        author: { id: "dev-deepinfra-glm-author", version: 1 },
        critic: { id: "economy-openai-critic", version: 1 },
      },
      {
        id: "development-gemini",
        label: "Development — Gemini Flash — unvalidated",
        tier: "economy",
        author: { id: "dev-google-gemini-author", version: 2 },
        critic: { id: "economy-openai-critic", version: 1 },
      },
      {
        id: "development-mistral",
        label: "Development — Mistral Large 4 (preview) — unvalidated",
        tier: "economy",
        author: { id: "dev-mistral-author", version: 1 },
        critic: { id: "economy-openai-critic", version: 1 },
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
