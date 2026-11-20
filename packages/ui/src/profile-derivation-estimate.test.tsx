import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  isLargeProfileDerivation,
  ProfileDerivationEstimateNote,
  profileDerivationEstimateText,
} from "./profile-derivation-estimate.js";
import {
  normalizeProfileDerivationEstimateResult,
  validateProfileDerivationEstimateInput,
} from "./profile-derivation-estimate-contract.js";

const large = {
  reusedSourceCount: 2,
  extractedSourceCount: 1,
  extractedCharacters: 245_000,
  calls: 9,
  estimatedUsd: { low: 0.75, high: 1.1 },
};

describe("profile derivation estimate (#3183)", () => {
  it("says what a large update reads, reuses and costs", () => {
    expect(profileDerivationEstimateText(large)).toBe(
      `Reads 1 source again (${(245_000).toLocaleString()} characters) and reuses 2: about 9 model calls, $0.75 to $1.10.`,
    );
    expect(profileDerivationEstimateText({ ...large, estimatedUsd: null })).toContain(
      "the cost is unknown for this model",
    );
  });

  it("shows the line only for a large update", () => {
    expect(isLargeProfileDerivation(large)).toBe(true);
    const small = { ...large, calls: 1, extractedCharacters: 4_000 };
    expect(isLargeProfileDerivation(small)).toBe(false);
    expect(renderToStaticMarkup(<ProfileDerivationEstimateNote estimate={small} />)).toBe("");
    expect(renderToStaticMarkup(<ProfileDerivationEstimateNote estimate={large} />)).toContain(
      "profile-derivation-estimate",
    );
    expect(renderToStaticMarkup(<ProfileDerivationEstimateNote estimate={undefined} />)).toBe("");
  });

  it("takes only the two ids and the full-extraction flag", () => {
    expect(
      validateProfileDerivationEstimateInput({
        workspaceId: "w1",
        profileId: "career",
        fullExtraction: true,
      }),
    ).toEqual({ workspaceId: "w1", profileId: "career", fullExtraction: true });
    expect(() =>
      validateProfileDerivationEstimateInput({ workspaceId: "w1", profileId: "career", x: 1 }),
    ).toThrow(TypeError);
    expect(() =>
      validateProfileDerivationEstimateInput({ workspaceId: "../w", profileId: "career" }),
    ).toThrow(TypeError);
  });

  it("refuses a malformed host answer", () => {
    expect(normalizeProfileDerivationEstimateResult(large)).toEqual(large);
    expect(normalizeProfileDerivationEstimateResult({ ...large, estimatedUsd: null })).toEqual({
      ...large,
      estimatedUsd: null,
    });
    expect(
      normalizeProfileDerivationEstimateResult({ ...large, estimatedUsd: { low: 2, high: 1 } }),
    ).toBeUndefined();
    expect(normalizeProfileDerivationEstimateResult({ ...large, calls: -1 })).toBeUndefined();
    expect(
      normalizeProfileDerivationEstimateResult({ ...large, source: "cv.pdf" }),
    ).toBeUndefined();
  });
});
