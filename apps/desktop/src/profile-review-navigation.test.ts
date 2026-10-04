import { describe, expect, it } from "vitest";

import type {
  CanonicalCandidateProfileFactResult,
  CanonicalCandidateProfileIssueResult,
  CanonicalCandidateProfileRecordResult,
} from "./bridge.js";
import {
  factCountLabel,
  issueCountLabel,
  profileFactCategoriesStartOpen,
  profileFactCollapseThreshold,
  profileFactMatchesFilter,
  profileIssueGroupStartsOpen,
  profileReviewBlockedReason,
  projectProfileFactCategories,
} from "./profile-review-navigation.js";

const provenance = {
  storeId: "store-1",
  knowledgeBaseId: "ckb-1",
  sourceId: "source-1",
  versionId: "version-1",
  kind: "candidate-provided" as const,
};

function fact(
  id: string,
  category: CanonicalCandidateProfileFactResult["category"],
  field: string,
  value: string,
): CanonicalCandidateProfileFactResult {
  return { id, category, field, value, provenance: [provenance] };
}

function issue(
  id: string,
  status: CanonicalCandidateProfileIssueResult["status"],
): CanonicalCandidateProfileIssueResult {
  return {
    id,
    code: "duplicate",
    severity: "warning",
    status,
    message: "Check this.",
    factIds: [],
    sourceRefs: [],
  };
}

const skillName = fact("f1", "skill", "skillName", "TypeScript");
const roleTitle = fact("f2", "role", "title", "Platform engineer");
const otherSkill = fact("f3", "skill", "skillName", "Rust");

function record(
  status: "draft" | "reviewed",
  facts: readonly CanonicalCandidateProfileFactResult[],
  issues: readonly CanonicalCandidateProfileIssueResult[],
): CanonicalCandidateProfileRecordResult {
  return {
    workspaceId: "workspace-1",
    profileId: "profile-1",
    version: 1,
    parentVersion: null,
    status,
    createdAt: "2026-08-28T10:00:00.000Z",
    updatedAt: "2026-08-28T10:00:00.000Z",
    reviewedAt: null,
    checksum: "a".repeat(64),
    facts,
    issues,
  };
}

const groups = [
  ["skill", [skillName, otherSkill]],
  ["role", [roleTitle]],
] as const;

describe("profile fact folding defaults", () => {
  it("collapses categories only above the threshold", () => {
    expect(profileFactCollapseThreshold).toBe(40);
    expect(profileFactCategoriesStartOpen(0)).toBe(true);
    expect(profileFactCategoriesStartOpen(40)).toBe(true);
    expect(profileFactCategoriesStartOpen(41)).toBe(false);
  });

  it("opens only the open issue group by default", () => {
    expect(profileIssueGroupStartsOpen("open")).toBe(true);
    expect(profileIssueGroupStartsOpen("acknowledged")).toBe(false);
    expect(profileIssueGroupStartsOpen("resolved")).toBe(false);
  });

  it("pluralises counts", () => {
    expect(factCountLabel(1)).toBe("1 fact");
    expect(factCountLabel(0)).toBe("0 facts");
    expect(factCountLabel(120)).toBe("120 facts");
    expect(issueCountLabel(1)).toBe("1 issue");
    expect(issueCountLabel(3)).toBe("3 issues");
  });
});

describe("profileFactMatchesFilter", () => {
  it("matches the humanized label case-insensitively", () => {
    expect(profileFactMatchesFilter(skillName, "skill name")).toBe(true);
    expect(profileFactMatchesFilter(skillName, "SKILL")).toBe(true);
  });

  it("matches the value case-insensitively", () => {
    expect(profileFactMatchesFilter(skillName, "typescript")).toBe(true);
    expect(profileFactMatchesFilter(skillName, "SCRIPT")).toBe(true);
  });

  it("does not match raw field text that the label hides", () => {
    expect(profileFactMatchesFilter(skillName, "skillname")).toBe(false);
  });

  it("matches everything for an empty or whitespace query", () => {
    expect(profileFactMatchesFilter(skillName, "")).toBe(true);
    expect(profileFactMatchesFilter(skillName, "   ")).toBe(true);
  });

  it("trims the query", () => {
    expect(profileFactMatchesFilter(skillName, "  rust ")).toBe(false);
    expect(profileFactMatchesFilter(otherSkill, "  rust ")).toBe(true);
  });
});

describe("projectProfileFactCategories", () => {
  it("keeps every category and uses the base state when not filtering", () => {
    const closed = projectProfileFactCategories(groups, "", false, new Map());
    expect(closed.filtering).toBe(false);
    expect(closed.matchCount).toBe(3);
    expect(closed.totalCount).toBe(3);
    expect(closed.categories.map((view) => [view.category, view.totalCount, view.open])).toEqual([
      ["skill", 2, false],
      ["role", 1, false],
    ]);
    const open = projectProfileFactCategories(groups, "  ", true, new Map());
    expect(open.filtering).toBe(false);
    expect(open.categories.every((view) => view.open)).toBe(true);
  });

  it("hides categories without matches and auto-opens the rest while filtering", () => {
    const projection = projectProfileFactCategories(groups, "rust", false, new Map());
    expect(projection.filtering).toBe(true);
    expect(projection.matchCount).toBe(1);
    expect(projection.totalCount).toBe(3);
    expect(projection.categories).toHaveLength(1);
    const [view] = projection.categories;
    expect(view?.category).toBe("skill");
    expect(view?.facts).toEqual([otherSkill]);
    expect(view?.totalCount).toBe(2);
    expect(view?.open).toBe(true);
  });

  it("reports no categories when nothing matches", () => {
    const projection = projectProfileFactCategories(groups, "zzz", true, new Map());
    expect(projection.categories).toEqual([]);
    expect(projection.matchCount).toBe(0);
    expect(projection.totalCount).toBe(3);
  });

  it("lets explicit overrides beat both the base state and the filter", () => {
    const overrides = new Map([
      ["skill", true],
      ["role", false],
    ] as const);
    const idle = projectProfileFactCategories(groups, "", false, overrides);
    expect(idle.categories.map((view) => view.open)).toEqual([true, false]);
    const filtering = projectProfileFactCategories(groups, "e", true, overrides);
    expect(filtering.categories.map((view) => [view.category, view.open])).toEqual([
      ["skill", true],
      ["role", false],
    ]);
  });
});

describe("profileReviewBlockedReason", () => {
  const facts = [skillName];
  const base = { editable: true, busy: false } as const;

  it("is null when review is allowed", () => {
    expect(
      profileReviewBlockedReason({
        ...base,
        record: record("draft", facts, [issue("a", "acknowledged")]),
        draftFacts: facts,
        draftIssues: [issue("a", "resolved")],
      }),
    ).toBeNull();
  });

  it("is null while busy even when review is blocked", () => {
    expect(
      profileReviewBlockedReason({
        ...base,
        busy: true,
        record: record("reviewed", facts, []),
        draftFacts: facts,
        draftIssues: [],
      }),
    ).toBeNull();
  });

  it("explains an already reviewed version", () => {
    expect(
      profileReviewBlockedReason({
        ...base,
        record: record("reviewed", facts, []),
        draftFacts: facts,
        draftIssues: [],
      }),
    ).toBe("This version is already reviewed.");
  });

  it("explains a version that is not the latest draft", () => {
    expect(
      profileReviewBlockedReason({
        ...base,
        editable: false,
        record: record("draft", facts, []),
        draftFacts: facts,
        draftIssues: [],
      }),
    ).toBe("Only the latest draft can be marked reviewed.");
  });

  it("explains an empty profile", () => {
    expect(
      profileReviewBlockedReason({
        ...base,
        record: record("draft", [], []),
        draftFacts: [],
        draftIssues: [],
      }),
    ).toBe("There are no facts to review.");
    expect(
      profileReviewBlockedReason({
        ...base,
        record: record("draft", facts, []),
        draftFacts: [],
        draftIssues: [],
      }),
    ).toBe("There are no facts to review.");
  });

  it("counts open draft issues with singular and plural wording", () => {
    expect(
      profileReviewBlockedReason({
        ...base,
        record: record("draft", facts, []),
        draftFacts: facts,
        draftIssues: [issue("a", "open"), issue("b", "resolved")],
      }),
    ).toBe("1 issue is still open. Acknowledge or resolve it, then save.");
    expect(
      profileReviewBlockedReason({
        ...base,
        record: record("draft", facts, []),
        draftFacts: facts,
        draftIssues: [issue("a", "open"), issue("b", "open")],
      }),
    ).toBe("2 issues are still open. Acknowledge or resolve them, then save.");
  });

  it("asks to save when only the saved record still has open issues", () => {
    expect(
      profileReviewBlockedReason({
        ...base,
        record: record("draft", facts, [issue("a", "open")]),
        draftFacts: facts,
        draftIssues: [issue("a", "resolved")],
      }),
    ).toBe("Save your issue decisions before marking the draft reviewed.");
  });

  it("orders reviewed before not-latest and not-latest before open issues", () => {
    expect(
      profileReviewBlockedReason({
        ...base,
        editable: false,
        record: record("reviewed", facts, []),
        draftFacts: facts,
        draftIssues: [issue("a", "open")],
      }),
    ).toBe("This version is already reviewed.");
    expect(
      profileReviewBlockedReason({
        ...base,
        editable: false,
        record: record("draft", facts, [issue("a", "open")]),
        draftFacts: facts,
        draftIssues: [issue("a", "open")],
      }),
    ).toBe("Only the latest draft can be marked reviewed.");
  });
});
