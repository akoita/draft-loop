import type { CanonicalCandidateProfileFact } from "@draft-loop/domain";
import {
  type FactSuggestionChange,
  factSuggestionDedupeKey,
  factSuggestionTarget,
} from "@draft-loop/domain/fact-suggestion";
import { factUsageKey } from "@draft-loop/domain/fact-usage";
import type { CanonicalCandidateProfileVersionRecord } from "@draft-loop/storage";
import { createMemoryFactSuggestionStore } from "@draft-loop/storage/fact-suggestions";
import { fixtureFactSuggestion } from "@draft-loop/storage/fact-suggestions-conformance";
import { describe, expect, it } from "vitest";

import type { CanonicalCandidateProfilePatch } from "./candidate-profile-persistence.js";
import {
  type CandidateStatementReference,
  createFactSuggestionDecisions,
  type FactSuggestionDecisionAudit,
  renderCandidateStatement,
} from "./fact-suggestion-decisions.js";

// Fictional facts and quotes only.
const source = {
  storeId: "store-1",
  knowledgeBaseId: "kb-1",
  sourceId: "cv",
  versionId: "cv-v1",
  kind: "candidate-provided",
} as const;
const teamSize = {
  id: "fact-1",
  category: "achievement",
  field: "team size",
  value: "Led a team of 5",
  provenance: [{ ...source, quote: "Led a team of 5" }],
} as unknown as CanonicalCandidateProfileFact;
const skill = {
  id: "fact-2",
  category: "skill",
  field: "language",
  value: "TypeScript",
  provenance: [source],
} as unknown as CanonicalCandidateProfileFact;
const statement = {
  storeId: "store-1",
  knowledgeBaseId: "kb-1",
  sourceId: "statement",
  versionId: "statement-v1",
} as unknown as CandidateStatementReference;
const member = { role: "candidate", memberId: "member-1" } as const;
const at = "2026-11-19T22:00:00.000Z";

function harness(options: { status?: "draft" | "reviewed"; issues?: unknown[] } = {}) {
  const store = createMemoryFactSuggestionStore();
  let latest = {
    profile: {
      id: "profile-1",
      version: 3,
      status: options.status ?? "reviewed",
      facts: [teamSize, skill],
      issues: options.issues ?? [],
    },
  } as unknown as CanonicalCandidateProfileVersionRecord;
  const edits: CanonicalCandidateProfilePatch[] = [];
  const reviews: number[] = [];
  const statements: string[] = [];
  const usage: [string, string][] = [];
  const audits: FactSuggestionDecisionAudit[] = [];
  const decisions = createFactSuggestionDecisions({
    store,
    profile: {
      latest: async () => latest,
      edit: async (_profileId, expectedVersion, patch) => {
        expect(expectedVersion).toBe(latest.profile.version);
        edits.push(patch);
        latest = {
          profile: { ...latest.profile, ...patch, version: expectedVersion + 1, status: "draft" },
        } as unknown as CanonicalCandidateProfileVersionRecord;
        return latest;
      },
      review: async (_profileId, expectedVersion) => {
        reviews.push(expectedVersion);
        latest = {
          profile: { ...latest.profile, status: "reviewed", version: expectedVersion + 1 },
        } as unknown as CanonicalCandidateProfileVersionRecord;
        return latest;
      },
    },
    publishStatement: async ({ markdown }) => {
      statements.push(markdown);
      return statement;
    },
    setFactUsage: async (key, level) => {
      usage.push([key, level]);
    },
    audit: async (event) => {
      audits.push(event);
    },
    now: () => at,
    generateFactId: () => "fact-new",
  });
  const file = async (id: string, change: FactSuggestionChange, fact = teamSize) => {
    const target = change.kind === "add" ? undefined : factSuggestionTarget(fact);
    const suggestion = {
      ...fixtureFactSuggestion(id, "unused"),
      change,
      target,
      dedupeKey: factSuggestionDedupeKey(change, target),
    };
    if (target === undefined) delete (suggestion as { target?: unknown }).target;
    await store.insert("owner", suggestion);
    return suggestion;
  };
  return {
    store,
    decisions,
    edits,
    reviews,
    statements,
    usage,
    audits,
    file,
    latest: () => latest,
  };
}

describe("accepting fact suggestions", () => {
  it("corrects a fact citing the statement and keeps a reviewed profile reviewed", async () => {
    const h = harness();
    await h.file("fsg_correct001", { kind: "correct", value: "Led a team of 8" });
    const result = await h.decisions.accept({
      workspaceId: "owner",
      profileId: "profile-1",
      items: [{ suggestionId: "fsg_correct001" }],
      decider: member,
    });
    expect(result).toMatchObject({ applied: ["fsg_correct001"], stale: [] });
    expect(h.statements[0]).toContain("> I said unused.");
    expect(h.latest().profile.facts[0]).toEqual({
      ...teamSize,
      value: "Led a team of 8",
      provenance: [{ ...statement, kind: "candidate-provided", quote: "I said unused." }],
    });
    expect(h.reviews).toEqual([4]);
    expect(h.latest().profile).toMatchObject({ version: 5, status: "reviewed" });
    expect(await h.store.get("owner", "fsg_correct001")).toMatchObject({
      status: "accepted",
      decision: { role: "candidate", memberId: "member-1", decidedAt: at },
    });
    expect(h.audits).toEqual([
      {
        action: "accepted",
        profileId: "profile-1",
        suggestionIds: ["fsg_correct001"],
        deciderRole: "candidate",
        applied: 1,
        stale: 0,
        profileVersion: 5,
      },
    ]);
    expect(JSON.stringify(h.audits)).not.toContain("team");
  });

  it("saves a draft when the base version was a draft", async () => {
    const h = harness({ status: "draft" });
    await h.file("fsg_confirm001", { kind: "confirm" });
    await h.decisions.accept({
      workspaceId: "owner",
      profileId: "profile-1",
      items: [{ suggestionId: "fsg_confirm001" }],
      decider: member,
    });
    expect(h.reviews).toEqual([]);
    expect(h.latest().profile).toMatchObject({ version: 4, status: "draft" });
    expect(h.latest().profile.facts[0]?.provenance).toHaveLength(2);
  });

  it("applies an edited change and records it", async () => {
    const h = harness();
    await h.file("fsg_edited0001", { kind: "correct", value: "Led a team of 8" });
    await h.decisions.accept({
      workspaceId: "owner",
      profileId: "profile-1",
      items: [
        { suggestionId: "fsg_edited0001", edit: { kind: "correct", value: "Led a team of 7" } },
      ],
      decider: member,
    });
    expect(h.latest().profile.facts[0]?.value).toBe("Led a team of 7");
    expect(await h.store.get("owner", "fsg_edited0001")).toMatchObject({
      status: "edited",
      appliedChange: { kind: "correct", value: "Led a team of 7" },
    });
    await h.file("fsg_edited0002", { kind: "retire" }, skill);
    await expect(
      h.decisions.accept({
        workspaceId: "owner",
        profileId: "profile-1",
        items: [{ suggestionId: "fsg_edited0002", edit: { kind: "confirm" } }],
        decider: member,
      }),
    ).rejects.toMatchObject({ code: "invalid_edit" });
  });

  it("accepts a batch in one version, marks a changed target stale and saves no statement for usage", async () => {
    const h = harness({
      issues: [{ id: "issue-1", code: "missing-evidence", factIds: ["fact-2"], status: "open" }],
    });
    await h.file("fsg_batch00001", {
      kind: "add",
      category: "skill",
      field: "language",
      value: "Go",
    });
    await h.file("fsg_batch00002", { kind: "retire" }, skill);
    await h.file("fsg_batch00003", { kind: "set-usage", usage: "interview-only" });
    await h.file(
      "fsg_batch00004",
      { kind: "correct", value: "Led a team of 9" },
      {
        ...teamSize,
        value: "Led a team of 4",
      },
    );
    const result = await h.decisions.accept({
      workspaceId: "owner",
      profileId: "profile-1",
      items: ["fsg_batch00001", "fsg_batch00002", "fsg_batch00003", "fsg_batch00004"].map(
        (suggestionId) => ({ suggestionId }),
      ),
      decider: member,
    });
    expect(result).toMatchObject({
      applied: ["fsg_batch00001", "fsg_batch00002", "fsg_batch00003"],
      stale: ["fsg_batch00004"],
    });
    expect(h.edits).toHaveLength(1);
    expect(h.latest().profile.facts.map((fact) => fact.id)).toEqual(["fact-1", "fact-new"]);
    expect(h.latest().profile.issues[0]?.factIds).toEqual([]);
    expect(h.usage).toEqual([[factUsageKey(teamSize), "interview-only"]]);
    expect(h.statements).toHaveLength(1);
    expect(h.statements[0]).not.toContain("fsg_batch00002");
    expect(await h.store.get("owner", "fsg_batch00004")).toMatchObject({ status: "stale" });
  });

  it("saves no version when only a usage level changes", async () => {
    const h = harness();
    await h.file("fsg_usage00001", { kind: "set-usage", usage: "never-say" });
    const result = await h.decisions.accept({
      workspaceId: "owner",
      profileId: "profile-1",
      items: [{ suggestionId: "fsg_usage00001" }],
      decider: member,
    });
    expect(result.profile).toBeUndefined();
    expect(h.edits).toEqual([]);
    expect(h.statements).toEqual([]);
  });

  it("refuses an unknown, decided or repeated suggestion", async () => {
    const h = harness();
    await h.file("fsg_refuse0001", { kind: "confirm" });
    const accept = (ids: string[]) =>
      h.decisions.accept({
        workspaceId: "owner",
        profileId: "profile-1",
        items: ids.map((suggestionId) => ({ suggestionId })),
        decider: member,
      });
    await expect(accept([])).rejects.toMatchObject({ code: "invalid_batch" });
    await expect(accept(["fsg_refuse0001", "fsg_refuse0001"])).rejects.toMatchObject({
      code: "invalid_batch",
    });
    await expect(accept(["fsg_missing001"])).rejects.toMatchObject({
      code: "suggestion_not_found",
    });
    await accept(["fsg_refuse0001"]);
    await expect(accept(["fsg_refuse0001"])).rejects.toMatchObject({
      code: "suggestion_not_found",
    });
  });
});

describe("rejecting a fact suggestion", () => {
  it("records the decision without touching the profile", async () => {
    const h = harness();
    await h.file("fsg_reject0001", { kind: "correct", value: "Led a team of 8" });
    await h.decisions.reject({
      workspaceId: "owner",
      profileId: "profile-1",
      suggestionId: "fsg_reject0001",
      decider: { role: "coach", memberId: "coach-1" },
    });
    expect(await h.store.get("owner", "fsg_reject0001")).toMatchObject({
      status: "rejected",
      decision: { role: "coach", memberId: "coach-1" },
    });
    expect(h.edits).toEqual([]);
    expect(h.audits[0]).toMatchObject({ action: "rejected", deciderRole: "coach" });
  });
});

describe("candidate statement source", () => {
  it("is dated, speaker-labelled and the same bytes for the same batch", () => {
    const suggestion = {
      ...fixtureFactSuggestion("fsg_render0001", "x"),
      quote: "Led   a\nteam # of 8",
    };
    const first = renderCandidateStatement([suggestion], at);
    expect(first.markdown).toContain("# Candidate statement 2026-11-19");
    expect(first.markdown).toContain("## Candidate, fsg_render0001");
    expect(first.markdown).toContain("> Led a team # of 8");
    expect(first.displayName).toMatch(/^candidate-statement-2026-11-19-[0-9a-f]{16}\.md$/u);
    expect(renderCandidateStatement([suggestion], at)).toEqual(first);
  });
});
