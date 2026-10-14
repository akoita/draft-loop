import type { RequirementCoverageAssessment } from "@draft-loop/validation";
import { describe, expect, it } from "vitest";

import { projectRevisionCoverage, revisionRequirementCoverage } from "./revision-coverage.js";

const judgedCovered: RequirementCoverageAssessment = {
  requirementId: "requirement-1",
  status: "covered",
  basis: "judgement",
  evidence: [{ blockId: "block-a", score: 0.7 }, { blockId: "block-b" }],
  rationale: "Both blocks state the required experience.",
};
const judgedUncovered: RequirementCoverageAssessment = {
  requirementId: "requirement-2",
  status: "uncovered",
  basis: "judgement",
  evidence: [],
  rationale: "No block states prompt hygiene.",
};
const unjudged: readonly RequirementCoverageAssessment[] = [
  {
    requirementId: "requirement-3",
    status: "covered",
    basis: "lexical",
    evidence: [{ blockId: "block-c" }],
    rationale: "Covered by matching wording in one CV block.",
  },
  {
    requirementId: "requirement-4",
    status: "needs-judgement",
    basis: "semantic-candidate",
    evidence: [{ blockId: "block-d", score: 0.5 }],
    rationale: "Possibly covered.",
  },
];

const critic = (round: number, judged: readonly RequirementCoverageAssessment[] | undefined) => ({
  runId: "run-1",
  contextSnapshotId: "context-1",
  round,
  step: "critic",
  status: "completed",
  ...(judged === undefined ? {} : { coverageJudgement: { assessments: judged } }),
});

describe("revision coverage projection", () => {
  it("keeps only judged verdicts, with cited blocks for covered requirements", () => {
    expect(projectRevisionCoverage([judgedCovered, judgedUncovered, ...unjudged])).toEqual([
      {
        requirementId: "requirement-1",
        verdict: "covered",
        rationale: "Both blocks state the required experience.",
        citedBlockIds: ["block-a", "block-b"],
      },
      {
        requirementId: "requirement-2",
        verdict: "uncovered",
        rationale: "No block states prompt hygiene.",
        citedBlockIds: [],
      },
    ]);
  });

  it("reads the latest completed critic step of the revised round of the same run", () => {
    const coverage = revisionRequirementCoverage({
      runId: "run-1",
      contextSnapshotId: "context-1",
      round: 3,
      executionHistory: [
        critic(1, [judgedUncovered]),
        critic(2, [judgedUncovered]),
        critic(2, [judgedCovered]),
        { ...critic(2, [judgedUncovered]), status: "failed" },
        { ...critic(2, [judgedUncovered]), runId: "run-2" },
        { ...critic(2, [judgedUncovered]), contextSnapshotId: "context-2" },
        critic(3, [judgedUncovered]),
      ],
    });

    expect(coverage?.map(({ requirementId }) => requirementId)).toEqual(["requirement-1"]);
  });

  it.each([
    ["a first draft", 1, [critic(1, [judgedCovered])]],
    ["a critic step without a judgement", 2, [critic(1, undefined)]],
    ["a judgement with no judged requirement", 2, [critic(1, unjudged)]],
    ["no critic step in the revised round", 2, []],
  ] as const)("returns nothing for %s", (_name, round, executionHistory) => {
    expect(
      revisionRequirementCoverage({
        runId: "run-1",
        contextSnapshotId: "context-1",
        round,
        executionHistory,
      }),
    ).toBeUndefined();
  });
});
