import { describe, expect, it } from "vitest";

import {
  findReviewedCanonicalCandidateProfileChoice,
  parseReviewedCanonicalCandidateProfileCatalogInput,
  parseReviewedCanonicalCandidateProfileCatalogResult,
  reviewedCanonicalCandidateProfileChoice,
} from "./profile-catalog.js";

describe("reviewed canonical candidate profile catalog contracts", () => {
  it("validates bounded workspace-scoped summaries and exact picker choices", () => {
    const input = parseReviewedCanonicalCandidateProfileCatalogInput({
      workspaceId: "workspace-a",
    });
    expect(input).toEqual({ workspaceId: "workspace-a" });

    const result = parseReviewedCanonicalCandidateProfileCatalogResult(
      {
        workspaceId: "workspace-a",
        profiles: [
          { profileId: "engineer", version: 2, reviewedAt: "2026-09-30T12:00:00.000Z" },
          { profileId: "writer", version: 1, reviewedAt: "2026-09-29T12:00:00.000Z" },
        ],
      },
      input.workspaceId,
    );
    const firstProfile = result.profiles[0];
    if (firstProfile === undefined) throw new Error("Expected a reviewed profile summary.");
    const choice = reviewedCanonicalCandidateProfileChoice(firstProfile);
    expect(choice).toBe("engineer@2");
    expect(findReviewedCanonicalCandidateProfileChoice(choice, result.profiles)).toEqual(
      firstProfile,
    );
    expect(findReviewedCanonicalCandidateProfileChoice("engineer@1", result.profiles)).toBe(
      undefined,
    );
    expect(findReviewedCanonicalCandidateProfileChoice("unlisted@2", result.profiles)).toBe(
      undefined,
    );
  });

  it("rejects malformed, duplicate, unordered, oversized, and foreign-workspace results", () => {
    const valid = {
      workspaceId: "workspace-a",
      profiles: [{ profileId: "engineer", version: 1, reviewedAt: "2026-09-30T12:00:00.000Z" }],
    };
    for (const value of [
      { ...valid, extra: true },
      { ...valid, profiles: [{ ...valid.profiles[0], facts: [] }] },
      { ...valid, profiles: [valid.profiles[0], valid.profiles[0]] },
      {
        ...valid,
        profiles: [
          { profileId: "writer", version: 1, reviewedAt: "2026-09-30T12:00:00.000Z" },
          valid.profiles[0],
        ],
      },
      {
        workspaceId: "workspace-a",
        profiles: Array.from({ length: 257 }, (_, index) => ({
          profileId: `profile-${String(index).padStart(3, "0")}`,
          version: 1,
          reviewedAt: "2026-09-30T12:00:00.000Z",
        })),
      },
    ]) {
      expect(() =>
        parseReviewedCanonicalCandidateProfileCatalogResult(value, "workspace-a"),
      ).toThrow("The reviewed profile catalog payload is invalid.");
    }
    expect(() =>
      parseReviewedCanonicalCandidateProfileCatalogInput({ workspaceId: " workspace-a" }),
    ).toThrow("The reviewed profile catalog payload is invalid.");
    expect(() => parseReviewedCanonicalCandidateProfileCatalogResult(valid, "workspace-b")).toThrow(
      "The reviewed profile catalog payload is invalid.",
    );
  });
});
