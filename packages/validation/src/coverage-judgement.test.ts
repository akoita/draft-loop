import { describe, expect, it } from "vitest";

import {
  applyCoverageJudgements,
  type CoverageJudgement,
  type CoverageJudgementRequest,
  coverageJudgementRequestsFrom,
  maximumCoverageJudgementRationaleCharacters,
  maximumCoverageJudgementRequests,
} from "./coverage-judgement.js";
import type { RequirementCoverageAssessment } from "./requirement-coverage-assessment.js";

function needsJudgement(
  requirementId: string,
  evidence: RequirementCoverageAssessment["evidence"] = [
    { blockId: "block-a", score: 0.8 },
    { blockId: "block-b", score: 0.7 },
  ],
): RequirementCoverageAssessment {
  return {
    requirementId,
    status: "needs-judgement",
    basis: "semantic-candidate",
    evidence,
    rationale: "Candidate blocks need a judgement.",
  };
}

function settled(
  requirementId: string,
  status: RequirementCoverageAssessment["status"],
  basis: RequirementCoverageAssessment["basis"] = "lexical",
): RequirementCoverageAssessment {
  return { requirementId, status, basis, evidence: [], rationale: "Settled." };
}

function satisfied(overrides: Partial<CoverageJudgement> = {}): CoverageJudgement {
  return {
    requirementId: "req-1",
    verdict: "satisfied",
    citedBlockIds: ["block-b"],
    rationale: "The block states the required experience.",
    ...overrides,
  };
}

function notSatisfied(overrides: Partial<CoverageJudgement> = {}): CoverageJudgement {
  return {
    requirementId: "req-1",
    verdict: "not-satisfied",
    citedBlockIds: [],
    rationale: "No candidate block states the requirement.",
    ...overrides,
  };
}

const request: CoverageJudgementRequest = {
  requirementId: "req-1",
  candidateBlockIds: ["block-a", "block-b"],
};

function apply(judgements: readonly unknown[], assessments = [needsJudgement("req-1")]) {
  return applyCoverageJudgements(assessments, [request], judgements as CoverageJudgement[]);
}

describe("coverageJudgementRequestsFrom", () => {
  it("requests only needs-judgement assessments with their candidate ids in order", () => {
    const requests = coverageJudgementRequestsFrom([
      settled("req-covered", "covered"),
      needsJudgement("req-1", [{ blockId: "block-b" }, { blockId: "block-a", score: 0.5 }]),
      settled("req-gap", "explicit-gap"),
      needsJudgement("req-2", []),
    ]);

    expect(requests).toEqual([
      { requirementId: "req-1", candidateBlockIds: ["block-b", "block-a"] },
      { requirementId: "req-2", candidateBlockIds: [] },
    ]);
    expect(Object.isFrozen(requests)).toBe(true);
    expect(Object.isFrozen(requests[0])).toBe(true);
    expect(Object.isFrozen(requests[0]?.candidateBlockIds)).toBe(true);
  });

  it("caps requests at the maximum by assessment order", () => {
    const assessments = Array.from({ length: maximumCoverageJudgementRequests + 3 }, (_, index) =>
      needsJudgement(`req-${index}`),
    );

    const requests = coverageJudgementRequestsFrom(assessments);

    expect(maximumCoverageJudgementRequests).toBe(24);
    expect(requests.map(({ requirementId }) => requirementId)).toEqual(
      assessments.slice(0, 24).map(({ requirementId }) => requirementId),
    );
  });

  it("requests lexically uncovered requirements without candidates, excluding protected rules", () => {
    const requests = coverageJudgementRequestsFrom([
      settled("req-uncovered", "uncovered"),
      settled("req-rule", "uncovered", "protected-rule"),
      settled("req-gap", "explicit-gap"),
      settled("req-judged", "uncovered", "judgement"),
      needsJudgement("req-1", [{ blockId: "block-a" }]),
    ]);

    expect(requests).toEqual([
      { requirementId: "req-uncovered", candidateBlockIds: [] },
      { requirementId: "req-1", candidateBlockIds: ["block-a"] },
    ]);
  });

  it("keeps requests with candidates first when over the cap, in requirement order", () => {
    const assessments = Array.from({ length: maximumCoverageJudgementRequests + 4 }, (_, index) =>
      index % 2 === 0 ? settled(`req-${index}`, "uncovered") : needsJudgement(`req-${index}`),
    );

    const ids = coverageJudgementRequestsFrom(assessments).map(
      ({ requirementId }) => requirementId,
    );

    const withCandidates = assessments.filter((_, index) => index % 2 === 1);
    const withoutCandidates = assessments.filter((_, index) => index % 2 === 0);
    const kept = new Set(
      [...withCandidates, ...withoutCandidates.slice(0, 24 - withCandidates.length)].map(
        ({ requirementId }) => requirementId,
      ),
    );
    expect(ids).toHaveLength(24);
    expect(ids).toEqual(
      assessments.map(({ requirementId }) => requirementId).filter((id) => kept.has(id)),
    );
    expect(ids).not.toContain(`req-${maximumCoverageJudgementRequests + 2}`);
  });

  it("returns no requests when nothing is judgeable", () => {
    expect(
      coverageJudgementRequestsFrom([
        settled("req-1", "covered"),
        settled("req-2", "uncovered", "protected-rule"),
        settled("req-3", "explicit-gap"),
      ]),
    ).toEqual([]);
  });
});

describe("applyCoverageJudgements with known block ids", () => {
  const known = ["block-a", "block-b", "block-education"];

  it("accepts a satisfied citation of a non-candidate block that exists", () => {
    const { assessments, summary } = applyCoverageJudgements(
      [needsJudgement("req-1")],
      [request],
      [satisfied({ citedBlockIds: ["block-education"] })],
      known,
    );

    expect(assessments[0]).toEqual({
      requirementId: "req-1",
      status: "covered",
      basis: "judgement",
      evidence: [{ blockId: "block-education" }],
      rationale: "The block states the required experience.",
    });
    expect(summary.satisfied).toBe(1);
  });

  it("covers a lexically uncovered requirement that had no candidates", () => {
    const uncovered = settled("req-1", "uncovered");
    const { assessments, summary } = applyCoverageJudgements(
      [uncovered],
      [{ requirementId: "req-1", candidateBlockIds: [] }],
      [satisfied({ citedBlockIds: ["block-education"] })],
      known,
    );

    expect(assessments[0]?.status).toBe("covered");
    expect(assessments[0]?.basis).toBe("judgement");
    expect(assessments[0]?.evidence).toEqual([{ blockId: "block-education" }]);
    expect(summary).toEqual({
      judged: 1,
      satisfied: 1,
      notSatisfied: 0,
      invalid: 0,
      unanswered: 0,
    });
  });

  it("rejects an unknown block and more than three citations", () => {
    for (const citedBlockIds of [
      ["block-unknown"],
      ["block-a", "block-unknown"],
      ["block-a", "block-b", "block-education", "block-c"],
    ]) {
      const assessment = needsJudgement("req-1");
      const { assessments, summary } = applyCoverageJudgements(
        [assessment],
        [request],
        [satisfied({ citedBlockIds })],
        [...known, "block-c"].filter((id) => id !== "block-unknown"),
      );

      expect(assessments[0]).toBe(assessment);
      expect(summary.invalid).toBe(1);
    }
  });

  it("keeps the candidate-only rule when no block ids are given", () => {
    const { summary } = applyCoverageJudgements(
      [needsJudgement("req-1")],
      [request],
      [satisfied({ citedBlockIds: ["block-education"] })],
    );

    expect(summary.invalid).toBe(1);
  });
});

describe("applyCoverageJudgements", () => {
  it("maps a valid satisfied judgement to covered with cited evidence and scores", () => {
    const { assessments, summary } = apply([satisfied()]);

    expect(assessments).toEqual([
      {
        requirementId: "req-1",
        status: "covered",
        basis: "judgement",
        evidence: [{ blockId: "block-b", score: 0.7 }],
        rationale: "The block states the required experience.",
      },
    ]);
    expect(summary).toEqual({
      judged: 1,
      satisfied: 1,
      notSatisfied: 0,
      invalid: 0,
      unanswered: 0,
    });
  });

  it("omits the score when the candidate had none and drops duplicate citations", () => {
    const { assessments } = applyCoverageJudgements(
      [needsJudgement("req-1", [{ blockId: "block-a" }, { blockId: "block-b", score: 0.7 }])],
      [request],
      [satisfied({ citedBlockIds: ["block-a", "block-a", "block-b"] })],
    );

    expect(assessments[0]?.evidence).toEqual([
      { blockId: "block-a" },
      { blockId: "block-b", score: 0.7 },
    ]);
    expect(assessments[0]?.evidence[0]).not.toHaveProperty("score");
  });

  it("maps a valid not-satisfied judgement to uncovered with no evidence", () => {
    const { assessments, summary } = apply([notSatisfied()]);

    expect(assessments[0]).toEqual({
      requirementId: "req-1",
      status: "uncovered",
      basis: "judgement",
      evidence: [],
      rationale: "No candidate block states the requirement.",
    });
    expect(summary).toEqual({
      judged: 1,
      satisfied: 0,
      notSatisfied: 1,
      invalid: 0,
      unanswered: 0,
    });
  });

  it("accepts not-satisfied with citations inside the candidates", () => {
    const { assessments } = apply([notSatisfied({ citedBlockIds: ["block-a"] })]);

    expect(assessments[0]?.status).toBe("uncovered");
    expect(assessments[0]?.evidence).toEqual([]);
  });

  it("leaves the assessment needs-judgement when no judgement answers it", () => {
    const original = needsJudgement("req-1");
    const { assessments, summary } = apply([], [original]);

    expect(assessments[0]).toBe(original);
    expect(summary).toEqual({
      judged: 0,
      satisfied: 0,
      notSatisfied: 0,
      invalid: 0,
      unanswered: 1,
    });
  });

  it.each([
    ["a citation outside the candidates", satisfied({ citedBlockIds: ["block-z"] })],
    [
      "a not-satisfied citation outside the candidates",
      notSatisfied({ citedBlockIds: ["block-z"] }),
    ],
    ["empty citations for satisfied", satisfied({ citedBlockIds: [] })],
    ["an unknown verdict", { ...satisfied(), verdict: "maybe" }],
    ["missing citations", { ...satisfied(), citedBlockIds: undefined }],
    ["an empty rationale", satisfied({ rationale: "" })],
    ["a whitespace rationale", satisfied({ rationale: "   " })],
    [
      "an over-long rationale",
      satisfied({ rationale: "x".repeat(maximumCoverageJudgementRationaleCharacters + 1) }),
    ],
    ["a multi-line rationale", satisfied({ rationale: "First line.\nSecond line." })],
    ["a carriage-return rationale", satisfied({ rationale: "First.\rSecond." })],
    ["a non-string rationale", { ...satisfied(), rationale: 42 }],
    ["a chain of thought marker", satisfied({ rationale: "My Chain Of Thought says yes." })],
    ["a hyphenated chain-of-thought marker", satisfied({ rationale: "chain-of-thought: yes" })],
    ["a thinking tag", satisfied({ rationale: "<thinking>yes</thinking>" })],
    ["a reasoning label", satisfied({ rationale: "Reasoning: it matches." })],
    ["a scratchpad marker", satisfied({ rationale: "From my SCRATCHPAD, it matches." })],
  ])("keeps needs-judgement for %s", (_label, judgement) => {
    const original = needsJudgement("req-1");
    const { assessments, summary } = apply([judgement], [original]);

    expect(assessments[0]).toBe(original);
    expect(summary).toEqual({
      judged: 0,
      satisfied: 0,
      notSatisfied: 0,
      invalid: 1,
      unanswered: 0,
    });
  });

  it("accepts a rationale of exactly the maximum length", () => {
    const { assessments } = apply([
      satisfied({ rationale: "x".repeat(maximumCoverageJudgementRationaleCharacters) }),
    ]);

    expect(assessments[0]?.status).toBe("covered");
  });

  it("ignores every judgement for a requirement that has duplicates", () => {
    const original = needsJudgement("req-1");
    const { assessments, summary } = apply([satisfied(), notSatisfied()], [original]);

    expect(assessments[0]).toBe(original);
    expect(summary).toEqual({
      judged: 0,
      satisfied: 0,
      notSatisfied: 0,
      invalid: 1,
      unanswered: 0,
    });
  });

  it("ignores judgements for unknown requirements and counts them as invalid", () => {
    const original = needsJudgement("req-1");
    const { assessments, summary } = apply([satisfied({ requirementId: "req-other" })], [original]);

    expect(assessments[0]).toBe(original);
    expect(summary).toEqual({
      judged: 0,
      satisfied: 0,
      notSatisfied: 0,
      invalid: 1,
      unanswered: 1,
    });
  });

  it("ignores judgements for requirements that were not requested", () => {
    const original = needsJudgement("req-2");
    const { assessments, summary } = apply([satisfied({ requirementId: "req-2" })], [original]);

    expect(assessments[0]).toBe(original);
    expect(summary).toEqual({
      judged: 0,
      satisfied: 0,
      notSatisfied: 0,
      invalid: 1,
      unanswered: 0,
    });
  });

  it("tolerates malformed judgement entries", () => {
    const original = needsJudgement("req-1");
    const { assessments, summary } = apply([null, "text", 7, [], {}], [original]);

    expect(assessments[0]).toBe(original);
    expect(summary).toEqual({
      judged: 0,
      satisfied: 0,
      notSatisfied: 0,
      invalid: 0,
      unanswered: 1,
    });
  });

  it("returns non-eligible assessments unchanged even when judged", () => {
    const covered = settled("req-covered", "covered");
    const protectedRule = settled("req-rule", "uncovered", "protected-rule");
    const gap = settled("req-gap", "explicit-gap");
    const requests: CoverageJudgementRequest[] = [
      request,
      { requirementId: "req-covered", candidateBlockIds: ["block-a"] },
      { requirementId: "req-rule", candidateBlockIds: ["block-a"] },
      { requirementId: "req-gap", candidateBlockIds: ["block-a"] },
    ];

    const { assessments, summary } = applyCoverageJudgements(
      [covered, needsJudgement("req-1"), protectedRule, gap],
      requests,
      [
        satisfied({ requirementId: "req-covered", citedBlockIds: ["block-a"] }),
        satisfied(),
        satisfied({ requirementId: "req-rule", citedBlockIds: ["block-a"] }),
        satisfied({ requirementId: "req-gap", citedBlockIds: ["block-a"] }),
      ],
    );

    expect(assessments[0]).toBe(covered);
    expect(assessments[1]?.status).toBe("covered");
    expect(assessments[2]).toBe(protectedRule);
    expect(assessments[3]).toBe(gap);
    expect(summary).toEqual({
      judged: 1,
      satisfied: 1,
      notSatisfied: 0,
      invalid: 3,
      unanswered: 0,
    });
  });

  it("counts a mixed batch in the summary", () => {
    const requests: CoverageJudgementRequest[] = [
      { requirementId: "req-1", candidateBlockIds: ["block-a"] },
      { requirementId: "req-2", candidateBlockIds: ["block-a"] },
      { requirementId: "req-3", candidateBlockIds: ["block-a"] },
      { requirementId: "req-4", candidateBlockIds: ["block-a"] },
    ];

    const { summary } = applyCoverageJudgements(
      ["req-1", "req-2", "req-3", "req-4"].map((id) => needsJudgement(id)),
      requests,
      [
        satisfied({ citedBlockIds: ["block-a"] }),
        notSatisfied({ requirementId: "req-2" }),
        satisfied({ requirementId: "req-3", citedBlockIds: ["block-z"] }),
      ],
    );

    expect(summary).toEqual({
      judged: 2,
      satisfied: 1,
      notSatisfied: 1,
      invalid: 1,
      unanswered: 1,
    });
  });

  it("freezes the result, summary, and rewritten assessments", () => {
    const result = apply([satisfied()]);

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.assessments)).toBe(true);
    expect(Object.isFrozen(result.summary)).toBe(true);
    expect(Object.isFrozen(result.assessments[0])).toBe(true);
    expect(Object.isFrozen(result.assessments[0]?.evidence)).toBe(true);
    expect(Object.isFrozen(result.assessments[0]?.evidence[0])).toBe(true);
  });

  it("does not mutate its inputs", () => {
    const original = needsJudgement("req-1");
    const snapshot = structuredClone(original);

    apply([satisfied()], [original]);

    expect(original).toEqual(snapshot);
  });
});
