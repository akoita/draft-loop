import type { RunSnapshot } from "@draft-loop/orchestrator";
import { describe, expect, it } from "vitest";

import { reviewCoverage } from "./review-coverage.js";

const summary = { judged: 1, satisfied: 1, notSatisfied: 0, invalid: 0, unanswered: 0 };

function execution(overrides: Record<string, unknown>): RunSnapshot["executionHistory"][number] {
  return {
    id: "x-1",
    runId: "run-1",
    contextSnapshotId: "ctx",
    round: 1,
    step: "critic",
    status: "completed",
    provider: "openai",
    modelId: "m",
    providerRequestId: null,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    estimatedUsd: null,
    completedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as RunSnapshot["executionHistory"][number];
}

function snapshot(executionHistory: RunSnapshot["executionHistory"], round = 1): RunSnapshot {
  return { runId: "run-1", round, executionHistory } as unknown as RunSnapshot;
}

function judgement(rationale: string): Record<string, unknown> {
  return {
    coverageJudgement: {
      instructionsVersion: "coverage-judgement-v1",
      summary,
      assessments: [
        {
          requirementId: "r-1",
          status: "covered",
          basis: "judgement",
          evidence: [{ blockId: "b-1", score: 0.91 }],
          rationale,
        },
      ],
    },
  };
}

describe("reviewCoverage", () => {
  it("is null when no critic execution carried a judgement", () => {
    expect(reviewCoverage(snapshot([]))).toBeNull();
    expect(reviewCoverage(snapshot([execution({}), execution({ step: "author" })]))).toBeNull();
  });

  it("projects the latest completed same-round critic judgement without scores", () => {
    const coverage = reviewCoverage(
      snapshot(
        [
          execution({ id: "old-round", round: 1, ...judgement("previous round") }),
          execution({ id: "first", round: 2, ...judgement("first current") }),
          execution({ id: "latest", round: 2, ...judgement("latest current") }),
          execution({ id: "failed", round: 2, status: "failed", ...judgement("failed") }),
        ],
        2,
      ),
    );

    expect(coverage).toEqual({
      instructionsVersion: "coverage-judgement-v1",
      summary,
      assessments: [
        {
          requirementId: "r-1",
          status: "covered",
          basis: "judgement",
          evidence: [{ blockId: "b-1" }],
          rationale: "latest current",
        },
      ],
    });
  });

  it("ignores a judgement from an earlier round", () => {
    expect(
      reviewCoverage(snapshot([execution({ round: 1, ...judgement("previous") })], 2)),
    ).toBeNull();
  });

  it("names each requirement with the text the run recorded, without control characters", () => {
    const coverage = reviewCoverage(
      snapshot([execution({ ...judgement("judged") })]),
      new Map([["r-1", "  Mastery of SQL\r\nand NoSQL databases  "]]),
    );
    expect(coverage?.assessments[0]).toMatchObject({
      requirementId: "r-1",
      requirementText: "Mastery of SQL \nand NoSQL databases",
    });
    // Without recorded text the id alone crosses the bridge.
    expect(
      reviewCoverage(snapshot([execution({ ...judgement("judged") })]))?.assessments[0],
    ).not.toHaveProperty("requirementText");
  });
});
