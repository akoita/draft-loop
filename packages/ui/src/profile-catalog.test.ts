import { describe, expect, it } from "vitest";

import {
  defaultProfileToAutoload,
  findReviewedCanonicalCandidateProfileChoice,
  parseReviewedCanonicalCandidateProfileCatalogInput,
  parseReviewedCanonicalCandidateProfileCatalogResult,
  reviewedCanonicalCandidateProfileChoice,
  type SavedCanonicalCandidateProfileSummary,
  savedCanonicalCandidateProfileLabel,
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

describe("saved canonical candidate profile summaries", () => {
  const summaries: readonly SavedCanonicalCandidateProfileSummary[] = [
    {
      profileId: "writer",
      latestVersion: 3,
      status: "draft",
      updatedAt: "2026-09-30T12:00:00.000Z",
      reviewedVersion: 2,
    },
    {
      profileId: "engineer",
      latestVersion: 1,
      status: "reviewed",
      updatedAt: "2026-09-29T12:00:00.000Z",
      reviewedVersion: 1,
    },
  ];

  it("validates the opt-in input and the optional summaries payload", () => {
    expect(
      parseReviewedCanonicalCandidateProfileCatalogInput({
        workspaceId: "workspace-a",
        includeDrafts: true,
      }),
    ).toEqual({ workspaceId: "workspace-a", includeDrafts: true });
    for (const includeDrafts of [false, "yes", 1, undefined]) {
      expect(() =>
        parseReviewedCanonicalCandidateProfileCatalogInput({
          workspaceId: "workspace-a",
          includeDrafts,
        }),
      ).toThrow();
    }
    expect(
      parseReviewedCanonicalCandidateProfileCatalogResult(
        { workspaceId: "workspace-a", profiles: [], summaries },
        "workspace-a",
      ),
    ).toEqual({ workspaceId: "workspace-a", profiles: [], summaries });
    expect(
      parseReviewedCanonicalCandidateProfileCatalogResult(
        { workspaceId: "workspace-a", profiles: [] },
        "workspace-a",
      ),
    ).toEqual({ workspaceId: "workspace-a", profiles: [] });
  });

  it("rejects malformed, duplicate, unordered, and inconsistent summaries", () => {
    const [first, second] = summaries;
    if (first === undefined || second === undefined) throw new Error("fixture");
    for (const bad of [
      [{ ...first, extra: true }],
      [{ ...first, status: "published" }],
      [{ ...first, latestVersion: 0 }],
      [{ ...first, updatedAt: "not a date" }],
      [{ ...first, profileId: "bad id" }],
      [{ ...first, reviewedVersion: 4 }],
      [{ ...second, reviewedVersion: undefined, status: "reviewed" }],
      [first, first],
      [second, first],
      Array.from({ length: 257 }, (_, index) => ({ ...first, profileId: `p${index}` })),
    ]) {
      expect(() =>
        parseReviewedCanonicalCandidateProfileCatalogResult(
          { workspaceId: "workspace-a", profiles: [], summaries: bad },
          "workspace-a",
        ),
      ).toThrow();
    }
  });

  it("labels summaries and auto-loads only the most recent one into an empty workspace", () => {
    expect(summaries[0] && savedCanonicalCandidateProfileLabel(summaries[0])).toBe(
      "writer · v3 · draft",
    );
    expect(defaultProfileToAutoload(summaries, "", null)).toBe(summaries[0]);
    expect(defaultProfileToAutoload(summaries, "  ", undefined)).toBe(summaries[0]);
    expect(defaultProfileToAutoload(summaries, "typed", null)).toBeUndefined();
    expect(defaultProfileToAutoload(summaries, "", "engineer")).toBeUndefined();
    expect(defaultProfileToAutoload([], "", null)).toBeUndefined();
  });
});
