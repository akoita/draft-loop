import { describe, expect, it } from "vitest";

import {
  defaultGraniteEmbeddingTier,
  embeddingModelFiles,
  getGraniteEmbeddingModel,
  graniteEmbeddingModels,
} from "./model-manifest.js";

describe("Granite embedding manifest", () => {
  it("defaults to the 311m tier and exposes every tier", () => {
    expect(defaultGraniteEmbeddingTier).toBe("311m");
    expect(Object.keys(graniteEmbeddingModels).sort()).toEqual(["311m", "97m", "eg2-text"]);
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

  it("lists the external data file after the graph for eg2-text only", () => {
    const eg2 = getGraniteEmbeddingModel("eg2-text");
    expect(embeddingModelFiles(eg2).map((file) => file.path)).toEqual([
      "onnx/model_q4.onnx",
      "onnx/model_q4.onnx_data",
      "tokenizer.json",
      "tokenizer_config.json",
    ]);
    expect(eg2.pooling).toBe("mean");
    expect(Object.isFrozen(eg2.files.modelData)).toBe(true);
    for (const tier of ["311m", "97m"] as const) {
      const granite = getGraniteEmbeddingModel(tier);
      expect(granite.files.modelData).toBeUndefined();
      expect(granite.pooling).toBe("cls");
      expect(embeddingModelFiles(granite)).toHaveLength(3);
    }
  });

  it.each(["311m", "97m", "eg2-text"] as const)("pins %s consistently", (tier) => {
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
