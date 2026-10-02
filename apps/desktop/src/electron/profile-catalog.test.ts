import { describe, expect, it } from "vitest";

import type { CanonicalCandidateProfileRecordResult } from "../bridge.js";
import { projectReviewedCanonicalCandidateProfileCatalog } from "./profile-catalog.js";

function projectedRecord(
  profileId: string,
  version: number,
  status: "draft" | "reviewed",
  overrides: Partial<CanonicalCandidateProfileRecordResult> = {},
): CanonicalCandidateProfileRecordResult {
  return {
    workspaceId: "workspace-a",
    profileId,
    version,
    parentVersion: version === 1 ? null : version - 1,
    status,
    createdAt: "2026-09-30T12:00:00.000Z",
    updatedAt: "2026-09-30T12:00:00.000Z",
    reviewedAt: status === "reviewed" ? "2026-09-30T12:00:00.000Z" : null,
    checksum: "a".repeat(64),
    facts: [{ id: "fact-1", category: "role", field: "title", value: "Engineer", provenance: [] }],
    issues: [],
    ...overrides,
  } as CanonicalCandidateProfileRecordResult;
}

function project(records: readonly CanonicalCandidateProfileRecordResult[]) {
  return projectReviewedCanonicalCandidateProfileCatalog(
    "workspace-a",
    records,
    (record) => record as CanonicalCandidateProfileRecordResult,
  );
}

describe("reviewed profile catalog projection", () => {
  it("returns the latest eligible reviewed version per name and excludes ineligible profiles", () => {
    const profiles = project([
      projectedRecord("writer", 1, "reviewed"),
      projectedRecord("writer", 2, "draft"),
      projectedRecord("empty", 1, "reviewed", { facts: [] }),
      projectedRecord("open-issue", 1, "reviewed", {
        issues: [{ id: "issue-1", status: "open" } as never],
      }),
      projectedRecord("engineer", 1, "reviewed"),
      projectedRecord("engineer", 2, "reviewed"),
    ]);
    expect(profiles).toEqual({
      workspaceId: "workspace-a",
      profiles: [
        { profileId: "engineer", version: 2, reviewedAt: "2026-09-30T12:00:00.000Z" },
        { profileId: "writer", version: 1, reviewedAt: "2026-09-30T12:00:00.000Z" },
      ],
    });
  });

  it("fails closed for foreign records and malformed version chains", () => {
    expect(() =>
      projectReviewedCanonicalCandidateProfileCatalog(
        "workspace-a",
        [projectedRecord("writer", 1, "reviewed")],
        () => projectedRecord("writer", 1, "reviewed", { workspaceId: "workspace-b" }),
      ),
    ).toThrow("The reviewed profile catalog payload is invalid.");
    expect(() => project([projectedRecord("writer", 2, "reviewed")])).toThrow(
      "The reviewed profile catalog payload is invalid.",
    );
  });
});
