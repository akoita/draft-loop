import type { CandidateProfileFreshness } from "@draft-loop/application";
import { describe, expect, it } from "vitest";

import { normalizeProfileFreshnessResult } from "../profile-freshness-contract.js";
import { projectProfileFreshness } from "./profile-freshness.js";

describe("profile freshness projection", () => {
  const project = (freshness: CandidateProfileFreshness | undefined) =>
    projectProfileFreshness("workspace-1", "profile-1", freshness);

  it("projects every application state to a contract-valid, path-free answer", () => {
    const projected = [
      project({ state: "not-generated" }),
      project({ state: "up-to-date", version: 3 }),
      project({
        state: "update-available",
        version: 3,
        newSourceCount: 2,
        changedSourceCount: 1,
        removedSourceCount: 0,
      }),
      project({ state: "review-pending", version: 4, reviewedVersion: 3 }),
      project({ state: "review-pending", version: 1 }),
      project({ state: "unavailable", version: 3 }),
      project(undefined),
    ];
    for (const answer of projected) {
      expect(normalizeProfileFreshnessResult(answer)).toEqual(answer);
    }
    expect(projected[3]).toMatchObject({ state: "review-pending", version: 4, reviewedVersion: 3 });
    expect(projected[6]).toMatchObject({ state: "unavailable", version: null });
  });
});
