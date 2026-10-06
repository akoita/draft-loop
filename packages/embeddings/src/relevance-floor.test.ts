import { describe, expect, it } from "vitest";

import { graniteEmbeddingModels } from "./model-manifest.js";
import {
  applySemanticRelevanceFloor,
  defaultSemanticRelevanceFloor,
  defaultSemanticRelevanceFloors,
  semanticRelevanceFloorForIdentity,
} from "./relevance-floor.js";

const hits = [
  { id: "a", score: 0.9 },
  { id: "b", score: 0.86 },
  { id: "c", score: 0.7 },
  { id: "d", score: 0.4 },
];

const ids = (scored: readonly { readonly id: string }[]): string[] => scored.map((hit) => hit.id);

describe("applySemanticRelevanceFloor", () => {
  it("returns nothing for empty input", () => {
    expect(applySemanticRelevanceFloor([], { maxMarginFromTop: 0.1, minimumScore: 0 })).toEqual([]);
  });

  it("drops hits further below the top score than the margin", () => {
    const kept = applySemanticRelevanceFloor(hits, { maxMarginFromTop: 0.05, minimumScore: -1 });
    expect(ids(kept)).toEqual(["a", "b"]);
  });

  it("drops hits below the absolute minimum even within the margin", () => {
    const kept = applySemanticRelevanceFloor(hits, { maxMarginFromTop: 1, minimumScore: 0.8 });
    expect(ids(kept)).toEqual(["a", "b"]);
  });

  it("requires both conditions", () => {
    const kept = applySemanticRelevanceFloor(hits, { maxMarginFromTop: 0.3, minimumScore: 0.8 });
    expect(ids(kept)).toEqual(["a", "b"]);
    const tight = applySemanticRelevanceFloor(hits, { maxMarginFromTop: 0.01, minimumScore: 0 });
    expect(ids(tight)).toEqual(["a"]);
  });

  it("returns nothing when even the top hit is under the minimum", () => {
    expect(applySemanticRelevanceFloor(hits, { maxMarginFromTop: 1, minimumScore: 0.95 })).toEqual(
      [],
    );
  });

  it("keeps hits exactly on either boundary and ties with the top", () => {
    const tied = [
      { id: "x", score: 0.5 },
      { id: "y", score: 0.5 },
      { id: "z", score: 0.25 },
    ];
    expect(
      ids(applySemanticRelevanceFloor(tied, { maxMarginFromTop: 0.25, minimumScore: 0.25 })),
    ).toEqual(["x", "y", "z"]);
    expect(
      ids(applySemanticRelevanceFloor(tied, { maxMarginFromTop: 0.2, minimumScore: 0.25 })),
    ).toEqual(["x", "y"]);
  });

  it("preserves input order and extra fields without mutating the input", () => {
    const input = [
      { id: "low", score: 0.6, payload: 1 },
      { id: "top", score: 0.9, payload: 2 },
      { id: "mid", score: 0.85, payload: 3 },
    ];
    const snapshot = structuredClone(input);
    const kept = applySemanticRelevanceFloor(input, { maxMarginFromTop: 0.1, minimumScore: 0 });
    expect(kept).toEqual([
      { id: "top", score: 0.9, payload: 2 },
      { id: "mid", score: 0.85, payload: 3 },
    ]);
    expect(input).toEqual(snapshot);
  });
});

describe("pinned default floors", () => {
  it("defines a serializable floor for every manifest tier", () => {
    expect(Object.keys(defaultSemanticRelevanceFloors).sort()).toEqual(
      Object.keys(graniteEmbeddingModels).sort(),
    );
    for (const tier of ["311m", "97m", "eg2-text"] as const) {
      const floor = defaultSemanticRelevanceFloor(tier);
      expect(JSON.parse(JSON.stringify(floor))).toEqual(floor);
      expect(floor.maxMarginFromTop).toBeGreaterThan(0);
      expect(floor.minimumScore).toBeGreaterThan(0);
      expect(Object.isFrozen(floor)).toBe(true);
    }
    expect(Object.isFrozen(defaultSemanticRelevanceFloors)).toBe(true);
  });

  it("resolves a floor only for a pinned model at its native dimensions", () => {
    const m311 = graniteEmbeddingModels["311m"];
    expect(
      semanticRelevanceFloorForIdentity({
        modelId: m311.modelId,
        dimensions: m311.nativeDimensions,
      }),
    ).toEqual(defaultSemanticRelevanceFloor("311m"));
    expect(semanticRelevanceFloorForIdentity({ modelId: m311.modelId, dimensions: 256 })).toBe(
      undefined,
    );
    expect(semanticRelevanceFloorForIdentity({ modelId: "other", dimensions: 768 })).toBe(
      undefined,
    );
  });
});
