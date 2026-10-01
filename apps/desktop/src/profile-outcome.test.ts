import { describe, expect, it } from "vitest";

import type {
  CanonicalCandidateProfileFactResult,
  CanonicalCandidateProfileIssueResult,
  CanonicalCandidateProfileRecordResult,
} from "./bridge.js";
import {
  canReviewCanonicalCandidateProfile,
  canSelectReviewedCanonicalCandidateProfile,
  projectCanonicalCandidateProfileOperationResult,
  projectCanonicalCandidateProfileOutcome,
  safeCanonicalCandidateProfileFeedback,
} from "./profile-outcome.js";

const provenance = {
  storeId: "store-1",
  knowledgeBaseId: "knowledge-1",
  sourceId: "source-1",
  versionId: "version-1",
  kind: "candidate-provided" as const,
};

const fact: CanonicalCandidateProfileFactResult = {
  id: "fact-1",
  category: "skill",
  field: "name",
  value: "TypeScript",
  provenance: [provenance],
};

function issue(
  code: CanonicalCandidateProfileIssueResult["code"] = "conflict-date",
  status: CanonicalCandidateProfileIssueResult["status"] = "acknowledged",
  message = "A saved issue needs review.",
): CanonicalCandidateProfileIssueResult {
  return {
    id: `issue-${code}-${status}`,
    code,
    severity: code === "omission" ? "error" : "warning",
    status,
    message,
    factIds: [],
    sourceRefs: [],
  };
}

function profile(
  overrides: Partial<CanonicalCandidateProfileRecordResult> = {},
): CanonicalCandidateProfileRecordResult {
  return {
    workspaceId: "workspace-1",
    profileId: "profile-1",
    version: 3,
    parentVersion: 2,
    status: "draft",
    createdAt: "2026-09-30T10:00:00.000Z",
    updatedAt: "2026-09-30T10:00:00.000Z",
    reviewedAt: null,
    checksum: "a".repeat(64),
    facts: [fact],
    issues: [],
    ...overrides,
  };
}

describe("canonical candidate profile outcome", () => {
  it("distinguishes a recorded output-limit failure from an empty profile", () => {
    const failed = profile({
      facts: [],
      issues: [
        issue(
          "omission",
          "open",
          "Profile extraction exceeded the available output limit. No facts were saved.",
        ),
      ],
    });
    expect(projectCanonicalCandidateProfileOutcome(failed, "profile-1", "profile-1")).toMatchObject(
      {
        kind: "extraction-failure",
        retry: true,
        failureReasons: [
          "Profile extraction exceeded the available output limit. No facts were saved.",
        ],
      },
    );
    expect(
      projectCanonicalCandidateProfileOutcome(
        profile({ facts: [], issues: [] }),
        "profile-1",
        "profile-1",
      ),
    ).toMatchObject({ kind: "empty", retry: true, failureReasons: [] });
    expect(
      projectCanonicalCandidateProfileOutcome(
        profile({
          facts: [],
          issues: [issue("duplicate", "acknowledged", "No facts were found.")],
        }),
        "profile-1",
        "profile-1",
      ),
    ).toMatchObject({ kind: "empty", retry: true, failureReasons: ["No facts were found."] });
  });

  it("shows credential guidance and sanitizes unknown, private, and duplicate reasons", () => {
    const credentials = profile({
      facts: [],
      issues: [
        issue(
          "omission",
          "open",
          "Provider authentication failed. Sign in or configure an API key.",
        ),
      ],
    });
    expect(
      projectCanonicalCandidateProfileOutcome(credentials, "profile-1", "profile-1").failureReasons,
    ).toEqual(["Provider authentication failed. Sign in or configure an API key."]);

    const privateMessages = profile({
      facts: [],
      issues: [
        issue("omission", "open", "Read /private/source.pdf"),
        issue("omission", "open", "Read /private/source.pdf"),
        issue("omission", "open", "See https://private.example.test/file"),
        issue("omission", "open", "x".repeat(241)),
      ],
    });
    const outcome = projectCanonicalCandidateProfileOutcome(
      privateMessages,
      "profile-1",
      "profile-1",
    );
    expect(outcome.failureReasons).toHaveLength(1);
    expect(outcome.failureReasons[0]).toBe(
      "The canonical candidate profile operation could not be completed.",
    );
    expect(JSON.stringify(outcome)).not.toContain("private");
    expect(
      safeCanonicalCandidateProfileFeedback(new Error("failed at C:\\candidate\\cv.pdf")),
    ).toBe("The canonical candidate profile operation could not be completed.");
  });

  it("limits deduplicated recorded reasons to three", () => {
    const failed = profile({
      facts: [],
      issues: [
        issue("omission", "open", "Cause one."),
        issue("omission", "open", "Cause one."),
        issue("omission", "open", "Cause two."),
        issue("omission", "open", "Cause three."),
        issue("omission", "open", "Cause four."),
      ],
    });
    expect(
      projectCanonicalCandidateProfileOutcome(failed, "profile-1", "profile-1").failureReasons,
    ).toEqual(["Cause one.", "Cause two.", "Cause three."]);
  });

  it("keeps a failed history load and an old name from attaching saved feedback", () => {
    expect(projectCanonicalCandidateProfileOperationResult(null)).toMatchObject({
      kind: "no-version",
      retry: false,
    });
    expect(projectCanonicalCandidateProfileOutcome(null, "profile-1", "profile-1").kind).toBe(
      "no-version",
    );
    const failed = profile({ facts: [], issues: [issue("omission", "open", "Old failure.")] });
    expect(
      projectCanonicalCandidateProfileOutcome(failed, "new-profile", "profile-1"),
    ).toMatchObject({
      kind: "unloaded",
      failureReasons: [],
      retry: false,
    });
    expect(projectCanonicalCandidateProfileOperationResult(failed).kind).toBe("extraction-failure");
    expect(projectCanonicalCandidateProfileOutcome(null, "profile-1", null).kind).toBe("unloaded");
  });

  it("describes drafts, issue blockers, and reviewed versions without claiming run readiness", () => {
    const savedDraft = profile({ issues: [issue("duplicate", "resolved")] });
    expect(
      projectCanonicalCandidateProfileOutcome(savedDraft, "profile-1", "profile-1"),
    ).toMatchObject({
      kind: "draft-review",
      message: "Draft profile version 3 is saved and requires human review.",
    });
    const openWarning = issue("duplicate", "open");
    expect(
      projectCanonicalCandidateProfileOutcome(
        savedDraft,
        "profile-1",
        "profile-1",
        [fact],
        [openWarning],
      ),
    ).toMatchObject({ kind: "blocked" });
    expect(
      projectCanonicalCandidateProfileOutcome(
        profile({ status: "reviewed", reviewedAt: "2026-09-30T10:00:00.000Z" }),
        "profile-1",
        "profile-1",
      ).kind,
    ).toBe("reviewed");
    expect(
      projectCanonicalCandidateProfileOutcome(
        profile({ status: "reviewed", reviewedAt: "2026-09-30T10:00:00.000Z", facts: [] }),
        "profile-1",
        "profile-1",
      ).kind,
    ).toBe("empty");
  });

  it("keeps review disabled until both saved and draft facts and issues satisfy prerequisites", () => {
    const saved = profile({ issues: [issue("duplicate", "acknowledged")] });
    expect(canReviewCanonicalCandidateProfile(saved, [fact], saved.issues)).toBe(true);
    expect(canReviewCanonicalCandidateProfile(saved, [], saved.issues)).toBe(false);
    expect(canReviewCanonicalCandidateProfile(profile({ facts: [] }), [fact], [])).toBe(false);
    expect(canReviewCanonicalCandidateProfile(saved, [fact], [issue("duplicate", "open")])).toBe(
      false,
    );
    expect(
      canReviewCanonicalCandidateProfile(profile(), [fact], [issue("duplicate", "resolved")]),
    ).toBe(true);
    expect(
      canReviewCanonicalCandidateProfile(
        profile({ issues: [issue("duplicate", "open")] }),
        [fact],
        [],
      ),
    ).toBe(false);
    expect(canSelectReviewedCanonicalCandidateProfile(profile())).toBe(false);
    expect(
      canSelectReviewedCanonicalCandidateProfile(
        profile({ status: "reviewed", reviewedAt: "2026-09-30T10:00:00.000Z", facts: [] }),
      ),
    ).toBe(false);
  });
});
