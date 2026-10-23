import type { ModelSelection } from "@draft-loop/domain";
import { describe, expect, it } from "vitest";
import { listModelProfileCatalog, type ModelProfileCatalogEntry } from "./model-profile-catalog.js";
import { defaultModelProfileRegistry } from "./model-profiles.js";
import { catalogModelPricing } from "./provider-model-pricing.js";

function selection(company: string, modelId: string): ModelSelection {
  return { company, modelId, role: "author", promptTemplateVersion: "author-v1" } as ModelSelection;
}

describe("catalog model pricing", () => {
  it("prices the Mistral development author and the economy critic from the catalog", () => {
    expect(catalogModelPricing(selection("mistral", "mistral-large-4"))).toEqual({
      inputUsdPerMillionTokens: 1.36,
      outputUsdPerMillionTokens: 4.18,
      cachedInputUsdPerMillionTokens: 1.36,
      maxInputTokens: 200000,
    });
    expect(catalogModelPricing(selection("openai", "gpt-6-luna"))).toMatchObject({
      inputUsdPerMillionTokens: 0.1,
      outputUsdPerMillionTokens: 0.5,
    });
  });

  it("prices the cache writes OpenAI reports for every OpenAI critic", () => {
    const critics = listModelProfileCatalog().filter(
      ({ profile }) => profile.provider === "openai" && profile.roles.includes("critic"),
    );
    expect(critics.length).toBeGreaterThan(0);
    for (const { profile } of critics) {
      expect(
        catalogModelPricing({ ...selection(profile.provider, profile.modelId), profile }),
      ).toMatchObject({
        cachedInputUsdPerMillionTokens: expect.any(Number),
        cacheWriteInputUsdPerMillionTokens: expect.any(Number),
      });
    }
  });

  it("uses the selected profile's rate card, including its input cap", () => {
    const profile = defaultModelProfileRegistry.resolve("economy-anthropic-author", 2, "author");
    expect(
      catalogModelPricing({ ...selection(profile.provider, profile.modelId), profile }),
    ).toMatchObject({ inputUsdPerMillionTokens: 0.1, maxInputTokens: 100000 });
  });

  it("prices Claude prompt-cache reads and one-hour writes from the catalog", () => {
    const profile = defaultModelProfileRegistry.resolve("standard-anthropic-author", 1, "author");
    expect(
      catalogModelPricing({ ...selection(profile.provider, profile.modelId), profile }),
    ).toEqual({
      inputUsdPerMillionTokens: 4,
      outputUsdPerMillionTokens: 20,
      cachedInputUsdPerMillionTokens: 0.2,
      cacheWriteInputUsdPerMillionTokens: 8,
      maxInputTokens: 200000,
    });
  });

  it("leaves a model unpriced when the catalog does not know it or disagrees on its price", () => {
    expect(catalogModelPricing(selection("openai", "gpt-unknown"))).toBeUndefined();
    const [entry] = listModelProfileCatalog() as [ModelProfileCatalogEntry];
    const conflicting: ModelProfileCatalogEntry[] = [
      entry,
      {
        ...entry,
        profile: { ...entry.profile, version: entry.profile.version + 1 },
        apiPricing: { ...entry.apiPricing, inputUsdPerMillion: 99 },
      },
    ];
    expect(
      catalogModelPricing(selection(entry.profile.provider, entry.profile.modelId), conflicting),
    ).toBeUndefined();
  });
});
