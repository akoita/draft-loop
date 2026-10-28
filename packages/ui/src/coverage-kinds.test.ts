import { describe, expect, it } from "vitest";
import { createCapabilityPort, type NativeBridge } from "./bridge.js";
import type { CoverageAssessmentView, ReviewCoverageView } from "./coverage-contract.js";
import { coverageKindTallies, relevanceScope } from "./coverage-kinds.js";
import { createFixtureReviewState } from "./model.js";
import { projectLatestOpportunity } from "./opportunity-projection.js";
import { compactReadinessBlocker } from "./review-footer.js";
import { coverageCollapsedSummary, coverageTabLabel } from "./review-work-tabs.js";
import {
  reviewedRequirementsLabel,
  reviewedRequirementsSelection,
} from "./start-requirements-model.js";

function assessment(
  requirementId: string,
  covered: boolean,
  kind?: CoverageAssessmentView["kind"],
): CoverageAssessmentView {
  return {
    requirementId,
    ...(kind === undefined ? {} : { kind }),
    status: covered ? "covered" : "uncovered",
    basis: "judgement",
    evidence: [],
    rationale: "Fictional rationale.",
  };
}

// The 0.6.2 walk's shape: 9 requirements, none covered, and 4 responsibilities, 2 covered.
const split: ReviewCoverageView = {
  instructionsVersion: "coverage-judgement-v1",
  summary: { judged: 13, satisfied: 2, notSatisfied: 11, invalid: 0, unanswered: 0 },
  assessments: [
    ...Array.from({ length: 9 }, (_, index) => assessment(`req-${index}`, false, "requirement")),
    assessment("resp-0", true, "responsibility"),
    assessment("resp-1", true, "responsibility"),
    assessment("resp-2", false, "responsibility"),
    assessment("resp-3", false, "responsibility"),
  ],
};

describe("coverage kinds", () => {
  it("counts requirements and responsibilities apart", () => {
    expect(coverageKindTallies(split)).toEqual({
      requirements: { covered: 0, total: 9 },
      responsibilities: { covered: 2, total: 4 },
    });
    expect(coverageCollapsedSummary(split)).toBe(
      "0 of 9 requirements covered · 2 of 4 responsibilities covered",
    );
    expect(coverageTabLabel(split)).toEqual({
      id: "coverage",
      label: "Coverage · 0/9 + 2/4",
      ariaLabel: "Coverage, 0 of 9 requirements and 2 of 4 responsibilities covered",
    });
  });

  it("keeps one tally when the run recorded no responsibilities", () => {
    const plain = { ...split, assessments: split.assessments.slice(0, 9) };
    expect(coverageKindTallies(plain)).toBeNull();
    expect(coverageCollapsedSummary(plain)).toBe("0 of 9 covered · 9 not covered");
    const unkinded = {
      ...split,
      assessments: split.assessments.map(({ kind: _kind, ...rest }) => rest),
    };
    expect(coverageKindTallies(unkinded)).toBeNull();
    expect(relevanceScope(unkinded)).toBeNull();
  });

  it("says what relevance is scored on", () => {
    const blocker = {
      code: "unmet-rubric-threshold" as const,
      dimension: "relevance" as const,
      score: 0,
      threshold: 0.8,
    };
    expect(compactReadinessBlocker(blocker, relevanceScope(split))).toBe(
      "relevance 0% over 9 requirements, not the 4 responsibilities (80% needed)",
    );
    expect(
      compactReadinessBlocker(
        { ...blocker, dimension: "evidence" as const },
        relevanceScope(split),
      ),
    ).toBe("evidence 0% (80% needed)");
    expect(compactReadinessBlocker(blocker, relevanceScope(null))).toBe(
      "relevance 0% (80% needed)",
    );
  });

  it("crosses the bridge with each assessment's kind and refuses an unknown one", async () => {
    const load = (coverage: unknown) =>
      createCapabilityPort({
        capabilities: ["review.load"],
        invoke: async () =>
          ({ ok: true, value: { ...createFixtureReviewState(), coverage } }) as never,
      } satisfies NativeBridge).execute({
        type: "review.load",
        input: { workspaceId: "workspace-1" },
      });
    const loaded = await load(split);
    expect(loaded).toMatchObject({ ok: true, value: { coverage: split } });
    const unknown = {
      ...split,
      assessments: [{ ...assessment("req-x", true), kind: "priority" }],
    };
    expect(await load(unknown)).toMatchObject({ ok: false });
  });
});

describe("responsibility count in the start dialog", () => {
  const brief = {
    id: "brief-1",
    version: 3,
    status: "reviewed",
    requirements: [
      { id: "req-1", text: "TypeScript", priority: "critical" },
      { id: "req-2", text: "Postgres", priority: "high" },
    ],
    responsibilities: [
      { id: "resp-1", text: "Own the ingestion pipeline" },
      // A responsibility that repeats a requirement's text or id is left to that requirement.
      { id: "resp-2", text: "  typescript " },
      { id: "req-2", text: "Run Postgres" },
      { id: "resp-3", text: "Talk to users" },
      { id: "resp-4", text: "talk to  users" },
    ],
  };

  it("counts the responsibilities a run checks, as the run dedupes them", () => {
    const latest = projectLatestOpportunity("workspace-1", { brief });
    expect(latest).toEqual({
      workspaceId: "workspace-1",
      briefId: "brief-1",
      version: 3,
      status: "reviewed",
      requirementCount: 2,
      criticalCount: 1,
      responsibilityCount: 2,
    });
    expect(JSON.stringify(latest)).not.toContain("ingestion");
    const selection = reviewedRequirementsSelection(latest, { briefId: "brief-1", version: 3 });
    expect(selection).not.toBeNull();
    if (selection === null) return;
    expect(reviewedRequirementsLabel(selection)).toBe(
      "Using reviewed requirements: brief v3 · 2 requirements · 1 critical · 2 responsibilities",
    );
    expect(reviewedRequirementsLabel({ ...selection, responsibilityCount: 1 })).toBe(
      "Using reviewed requirements: brief v3 · 2 requirements · 1 critical · 1 responsibility",
    );
    expect(reviewedRequirementsLabel({ ...selection, responsibilityCount: 0 })).toBe(
      "Using reviewed requirements: brief v3 · 2 requirements · 1 critical",
    );
  });

  it("treats a host without the count as none", () => {
    const { responsibilityCount: _count, ...older } = projectLatestOpportunity("workspace-1", {
      brief,
    });
    expect(
      reviewedRequirementsSelection(older, { briefId: "brief-1", version: 3 })?.responsibilityCount,
    ).toBe(0);
  });
});
