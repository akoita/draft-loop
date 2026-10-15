import { describe, expect, it } from "vitest";

import type {
  CanonicalCandidateProfileIssueResult,
  CanonicalCandidateProfileRecordResult,
} from "./bridge.js";
import type { ProfileFreshnessResult } from "./profile-freshness-contract.js";
import { projectCanonicalCandidateProfileOutcome } from "./profile-outcome.js";
import {
  profileApprovalText,
  profilePrimaryActionLabel,
  projectProfileStatus,
} from "./profile-status.js";

const at = "2026-09-01T10:00:00.000Z";
const reference = {
  storeId: "store-1",
  knowledgeBaseId: "ckb-1",
  sourceId: "source-1",
  versionId: "version-1",
  kind: "candidate-provided" as const,
};

function issue(
  id: string,
  status: CanonicalCandidateProfileIssueResult["status"],
): CanonicalCandidateProfileIssueResult {
  return {
    id,
    code: "conflict-date",
    severity: "warning",
    status,
    message: "The dates disagree.",
    factIds: [],
    sourceRefs: [reference],
  };
}

function record(
  status: "draft" | "reviewed",
  issues: readonly CanonicalCandidateProfileIssueResult[] = [],
  facts = 1,
): CanonicalCandidateProfileRecordResult {
  return {
    workspaceId: "workspace-1",
    profileId: "sample-profile",
    version: 3,
    parentVersion: 2,
    status,
    createdAt: at,
    updatedAt: at,
    reviewedAt: status === "reviewed" ? at : null,
    checksum: "b".repeat(64),
    facts: Array.from({ length: facts }, (_, index) => ({
      id: `fact-${index}`,
      category: "skill" as const,
      field: "name",
      value: `Skill ${index}`,
      provenance: [reference],
    })),
    issues,
  };
}

function statusOf(
  loaded: CanonicalCandidateProfileRecordResult | null,
  freshness?: ProfileFreshnessResult,
) {
  const outcome = projectCanonicalCandidateProfileOutcome(
    loaded,
    "sample-profile",
    "sample-profile",
  );
  return projectProfileStatus({
    outcome,
    draftIssues: loaded?.issues ?? [],
    version: loaded?.version ?? null,
    freshness,
  });
}

function freshness(state: ProfileFreshnessResult["state"]): ProfileFreshnessResult {
  return {
    workspaceId: "workspace-1",
    profileId: "sample-profile",
    state,
    version: 3,
    reviewedVersion: null,
    newSourceCount: state === "update-available" ? 2 : 0,
    changedSourceCount: state === "update-available" ? 1 : 0,
    removedSourceCount: 0,
  };
}

describe("career profile status", () => {
  it("offers Generate profile when there is no profile yet", () => {
    const status = statusOf(null);
    expect(status).toMatchObject({ kind: "none", issueCount: 0, primaryAction: "generate" });
    expect(status.label).toBe("No profile yet");
    expect(profilePrimaryActionLabel(status)).toBe("Generate profile");

    const unloaded = projectProfileStatus({
      outcome: projectCanonicalCandidateProfileOutcome(null, "", null),
      draftIssues: [],
      version: null,
    });
    expect(unloaded.kind).toBe("none");
  });

  it("treats a failed or empty generation as no usable profile", () => {
    const failed = statusOf({
      ...record("draft", [{ ...issue("failure", "open"), code: "omission", severity: "error" }]),
      facts: [],
    });
    expect(failed).toMatchObject({ kind: "none", primaryAction: "generate" });
    expect(failed.label).toBe("Generation failed");

    const empty = statusOf(record("draft", [], 0));
    expect(empty).toMatchObject({ kind: "none", primaryAction: "generate" });
  });

  it("counts open issues on a draft and offers Review issues", () => {
    const status = statusOf(
      record("draft", [issue("a", "open"), issue("b", "open"), issue("c", "resolved")]),
    );
    expect(status).toMatchObject({ kind: "needs-review", issueCount: 2, primaryAction: "review" });
    expect(status.label).toBe("Needs review: 2 issues");
    expect(profilePrimaryActionLabel(status)).toBe("Review issues");

    const one = statusOf(record("draft", [issue("a", "open")]));
    expect(one.label).toBe("Needs review: 1 issue");
  });

  it("asks for a review of a draft with no open issues", () => {
    const status = statusOf(record("draft", [issue("a", "acknowledged")]));
    expect(status).toMatchObject({ kind: "needs-review", issueCount: 0, primaryAction: "review" });
    expect(profilePrimaryActionLabel(status)).toBe("Review profile");
  });

  it("reports a reviewed profile as ready unless the evidence changed", () => {
    for (const answer of [undefined, freshness("up-to-date"), freshness("unavailable")]) {
      const status = statusOf(record("reviewed"), answer);
      expect(status).toMatchObject({ kind: "ready", issueCount: 0, primaryAction: null });
      expect(status.label).toBe("Ready");
      expect(status.detail).toBe("Reviewed version 3 is used for new applications.");
      expect(profilePrimaryActionLabel(status)).toBeNull();
    }
  });

  it("reports out of date with the changed source counts and offers Update profile", () => {
    const status = statusOf(record("reviewed"), freshness("update-available"));
    expect(status).toMatchObject({ kind: "out-of-date", primaryAction: "update" });
    expect(status.label).toBe("Out of date with your evidence");
    expect(status.detail).toBe(
      "Your career evidence changed since this profile was reviewed: 2 new, 1 updated source.",
    );
    expect(profilePrimaryActionLabel(status)).toBe("Update profile");
  });

  it("keeps primary status text free of internal jargon", () => {
    const statuses = [
      statusOf(null),
      statusOf(record("draft", [issue("a", "open")])),
      statusOf(record("draft")),
      statusOf(record("reviewed")),
      statusOf(record("reviewed"), freshness("update-available")),
    ];
    for (const status of statuses) {
      expect(`${status.label} ${status.detail}`).not.toMatch(
        /canonical|immutable|bounded|provider-independent/iu,
      );
    }
  });
});

describe("profile approval text", () => {
  it("says what is sent, to whom, and why", () => {
    expect(
      profileApprovalText({ mode: "generate", sourceCount: 12, providerName: "Anthropic" }),
    ).toBe("Send my career evidence (up to 12 sources) to Anthropic to build the profile.");
    expect(profileApprovalText({ mode: "update", sourceCount: 1, providerName: "OpenAI" })).toBe(
      "Send my career evidence (up to 1 source) to OpenAI to update the profile.",
    );
  });

  it("never guesses a count or a provider it was not given", () => {
    expect(profileApprovalText({ mode: "generate" })).toBe(
      "Send my career evidence to the configured provider to build the profile.",
    );
    expect(profileApprovalText({ mode: "generate", sourceCount: -1, providerName: " " })).toBe(
      "Send my career evidence to the configured provider to build the profile.",
    );
  });
});
