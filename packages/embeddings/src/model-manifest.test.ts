import { describe, expect, it } from "vitest";

import {
  defaultGraniteEmbeddingTier,
  getGraniteEmbeddingModel,
  graniteEmbeddingModels,
} from "./model-manifest.js";

describe("Granite embedding manifest", () => {
  it("defaults to the 311m tier and exposes both tiers", () => {
    expect(defaultGraniteEmbeddingTier).toBe("311m");
    expect(Object.keys(graniteEmbeddingModels).sort()).toEqual(["311m", "97m"]);
    expect(getGraniteEmbeddingModel()).toBe(graniteEmbeddingModels["311m"]);
    expect(getGraniteEmbeddingModel("97m").nativeDimensions).toBe(384);
  });

  it("is deeply frozen", () => {
    const model = getGraniteEmbeddingModel("311m");
    expect(Object.isFrozen(graniteEmbeddingModels)).toBe(true);
    expect(Object.isFrozen(model)).toBe(true);
    expect(Object.isFrozen(model.files)).toBe(true);
    expect(Object.isFrozen(model.files.model)).toBe(true);
    expect(Object.isFrozen(model.matryoshkaDimensions)).toBe(true);
  });

  it.each(["311m", "97m"] as const)("pins %s consistently", (tier) => {
    const model = getGraniteEmbeddingModel(tier);
    expect(model.matryoshkaDimensions).toContain(model.nativeDimensions);
    expect(model.revision).toMatch(/^[0-9a-f]{40}$/);
    expect(model.license).toBe("Apache-2.0");
    expect(model.defaultMaxTokens).toBeLessThanOrEqual(model.maximumMaxTokens);
    for (const file of Object.values(model.files)) {
      expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(file.sizeBytes).toBeGreaterThan(0);
      expect(file.path).not.toMatch(/^\//);
    }
  });
});
