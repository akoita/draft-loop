import { describe, expect, it } from "vitest";

import { cosineSimilarity, l2Normalize, truncateAndNormalize } from "./vector.js";

describe("vector helpers", () => {
  it("normalizes to unit length", () => {
    const result = l2Normalize([3, 4]);
    expect(result[0]).toBeCloseTo(0.6);
    expect(result[1]).toBeCloseTo(0.8);
  });

  it("rejects zero and non-finite vectors", () => {
    expect(() => l2Normalize([0, 0])).toThrow(RangeError);
    expect(() => l2Normalize([Number.NaN, 1])).toThrow(RangeError);
    expect(() => l2Normalize([Number.POSITIVE_INFINITY, 1])).toThrow(RangeError);
  });

  it("truncates then renormalizes", () => {
    const result = truncateAndNormalize([3, 4, 12], 2);
    expect(result).toHaveLength(2);
    expect(result[0]).toBeCloseTo(0.6);
    expect(result[1]).toBeCloseTo(0.8);
  });

  it("rejects impossible truncation sizes", () => {
    expect(() => truncateAndNormalize([1, 2], 3)).toThrow(RangeError);
    expect(() => truncateAndNormalize([1, 2], 0)).toThrow(RangeError);
    expect(() => truncateAndNormalize([1, 2], 1.5)).toThrow(RangeError);
  });

  it("computes cosine similarity", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
  });

  it("rejects mismatched or zero vectors in cosine similarity", () => {
    expect(() => cosineSimilarity([1], [1, 2])).toThrow(RangeError);
    expect(() => cosineSimilarity([0, 0], [1, 2])).toThrow(RangeError);
  });
});
