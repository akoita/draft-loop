import { describe, expect, it } from "vitest";
import {
  type ApprovalReadinessBlocker,
  normalizeApprovalReadiness,
  projectApprovalReadiness,
} from "./approval-readiness.js";
import { findingProgressLine, NOT_CRITIQUED_PROGRESS } from "./finding-progress.js";
import { formatReadinessBlockers, groupReadinessBlockers } from "./readiness-blocker-groups.js";
import { compactReadinessBlockers } from "./review-footer.js";
import { sendVerdict } from "./send-verdict.js";

// The 0.6.2 walk: six word-match misses and the six report findings they raised.
const wordMatch: ApprovalReadinessBlocker = {
  code: "deterministic-error",
  check: "uncovered-requirement",
};
const reportFinding: ApprovalReadinessBlocker = { code: "report-error" };
const walkBlockers: readonly ApprovalReadinessBlocker[] = [
  ...Array.from({ length: 6 }, () => wordMatch),
  ...Array.from({ length: 6 }, () => reportFinding),
];

describe("grouped readiness blockers", () => {
  it("counts identical blockers once and names the check", () => {
    expect(groupReadinessBlockers(walkBlockers)).toEqual([
      { blocker: wordMatch, count: 6 },
      { blocker: reportFinding, count: 6 },
    ]);
    expect(formatReadinessBlockers(walkBlockers)).toEqual([
      "6 validation checks failed: requirement wording not found in the draft (word match)",
      "6 readiness report findings block readiness",
    ]);
    expect(compactReadinessBlockers(walkBlockers)).toEqual([
      "6 validation checks failed: requirement wording not found in the draft (word match)",
      "6 readiness report findings block readiness",
    ]);
    expect(
      sendVerdict({ blocking: [], warnings: [], readiness: readiness(walkBlockers) }).reasons,
    ).toHaveLength(2);
  });

  it("keeps different checks and dimensions apart, and single blockers as before", () => {
    const blockers: ApprovalReadinessBlocker[] = [
      wordMatch,
      { code: "deterministic-error", check: "unsupported-claim" },
      { code: "report-error", dimension: "evidence" },
      { code: "report-error", dimension: "evidence" },
      { code: "deterministic-error" },
    ];
    expect(formatReadinessBlockers(blockers)).toEqual([
      "Validation check failed: requirement wording not found in the draft (word match)",
      "Validation check failed: claim without evidence",
      "2 readiness report findings on evidence block readiness",
      "A deterministic validation check blocks readiness",
    ]);
  });

  it("carries a known check code across the bridge and refuses others", () => {
    const valid = readiness([wordMatch]);
    expect(normalizeApprovalReadiness(valid)).toEqual(valid);
    expect(
      normalizeApprovalReadiness(readiness([{ ...wordMatch, check: "private-text" } as never])),
    ).toBeNull();
    expect(
      normalizeApprovalReadiness(
        readiness([{ code: "report-error", check: "uncovered-requirement" }]),
      ),
    ).toBeNull();
  });

  it("projects a recorded check code, and drops an unknown one", () => {
    const artifact = { id: "artifact-1", version: 2 };
    const decision = (checkCode: string) => ({
      artifact,
      applicationReady: false,
      blockers: [{ code: "deterministic-error", checkCode, requirementId: "req-1" }],
    });
    expect(projectApprovalReadiness(decision("uncovered-requirement"), artifact)?.blockers).toEqual(
      [wordMatch],
    );
    expect(projectApprovalReadiness(decision("future-check"), artifact)?.blockers).toEqual([
      { code: "deterministic-error" },
    ]);
  });
});

describe("finding progress", () => {
  it("says the critique has not run instead of calling nothing resolved", () => {
    const none = { resolved: 0, total: 0, needsAction: 0, runInProgress: true };
    expect(findingProgressLine({ ...none, critiqued: false })).toBe(NOT_CRITIQUED_PROGRESS);
    expect(findingProgressLine({ ...none, critiqued: true })).toBe(
      "0 of 0 resolved · all findings resolved",
    );
    expect(
      findingProgressLine({
        resolved: 1,
        total: 3,
        needsAction: 2,
        runInProgress: false,
        critiqued: false,
      }),
    ).toBe("1 of 3 resolved · 2 need action");
  });
});

function readiness(blockers: readonly ApprovalReadinessBlocker[]) {
  return {
    artifactId: "artifact-1",
    artifactVersion: 2,
    applicationReady: false,
    blockers,
  };
}
