import type { RunEvent, RunEventType, RunSnapshot } from "@draft-loop/orchestrator";
import { describe, expect, it } from "vitest";
import { outputCoverageAssessments, outputEvents, runEventLine } from "./run-output.js";

const eventTypes: readonly RunEventType[] = [
  "run.created",
  "state.changed",
  "step.started",
  "step.completed",
  "execution.reused",
  "provider.failed",
  "provider.recovered",
  "budget.exhausted",
  "user.paused",
  "user.stopped",
  "user.approved",
  "user.exported",
  "user.revision-requested",
  "user.adjudicated-revision-requested",
  "user.round-budget-recovered",
];

function event(overrides: Partial<RunEvent>): RunEvent {
  return {
    id: "event-1",
    runId: "run-1",
    workspaceId: "workspace-1",
    type: "state.changed",
    state: "drafting",
    round: 2,
    step: "critic",
    createdAt: "2026-01-01T00:00:00.000Z",
    sequence: 1,
    ...overrides,
  };
}

function coverageEvent(details: NonNullable<RunEvent["details"]>): RunEvent {
  return event({ type: "coverage.judged", details });
}

describe("run event lines", () => {
  it.each(eventTypes)("keeps the generic line for %s, with and without a step", (type) => {
    expect(runEventLine(event({ type }))).toBe(`event ${type}: state=drafting round=2 step=critic`);
    expect(runEventLine(event({ type, step: null, details: { executionId: "e-1" } }))).toBe(
      `event ${type}: state=drafting round=2`,
    );
  });

  it("writes one line per event in order", () => {
    const lines: string[] = [];
    outputEvents([event({ type: "run.created", step: null }), event({})], {
      write: (line) => lines.push(line),
    });
    expect(lines).toEqual([
      "event run.created: state=drafting round=2",
      "event state.changed: state=drafting round=2 step=critic",
    ]);
  });

  it("summarises a coverage judgement without the zero invalid and unanswered parts", () => {
    expect(
      runEventLine(
        coverageEvent({
          executionId: "e-1",
          requested: 3,
          instructionsVersion: "coverage-judgement-v1",
          judged: 3,
          satisfied: 2,
          notSatisfied: 1,
          invalid: 0,
          unanswered: 0,
        }),
      ),
    ).toBe("Coverage judgement: 3 requested, 2 satisfied, 1 not satisfied (coverage-judgement-v1)");
  });

  it("includes invalid and unanswered counts when present", () => {
    expect(
      runEventLine(
        coverageEvent({
          requested: 5,
          instructionsVersion: "coverage-judgement-v1",
          judged: 2,
          satisfied: 1,
          notSatisfied: 1,
          invalid: 2,
          unanswered: 1,
        }),
      ),
    ).toBe(
      "Coverage judgement: 5 requested, 1 satisfied, 1 not satisfied, 2 invalid, 1 unanswered (coverage-judgement-v1)",
    );
    expect(
      runEventLine(
        coverageEvent({
          requested: 2,
          instructionsVersion: "v1",
          satisfied: 0,
          notSatisfied: 0,
          invalid: 0,
          unanswered: 2,
        }),
      ),
    ).toBe("Coverage judgement: 2 requested, 0 satisfied, 0 not satisfied, 2 unanswered (v1)");
  });

  it("labels a missing instructions version as unversioned", () => {
    expect(
      runEventLine(
        coverageEvent({
          requested: 1,
          instructionsVersion: null,
          satisfied: 1,
          notSatisfied: 0,
          invalid: 0,
          unanswered: 0,
        }),
      ),
    ).toBe("Coverage judgement: 1 requested, 1 satisfied, 0 not satisfied (unversioned)");
  });
});

const summary = { judged: 0, satisfied: 0, notSatisfied: 0, invalid: 0, unanswered: 0 };

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

function lines(value: RunSnapshot): string[] {
  const output: string[] = [];
  outputCoverageAssessments(value, { write: (line) => output.push(line) });
  return output;
}

describe("requirement coverage listing", () => {
  it("prints nothing without a critic coverage judgement", () => {
    expect(lines(snapshot([execution({}), execution({ step: "author" })]))).toEqual([]);
  });

  it("lists each assessment with its status, basis, evidence and rationale", () => {
    const output = lines(
      snapshot([
        execution({
          coverageJudgement: {
            instructionsVersion: "coverage-judgement-v1",
            summary,
            assessments: [
              {
                requirementId: "r-1",
                status: "covered",
                basis: "lexical",
                evidence: [{ blockId: "b-1" }, { blockId: "b-2", score: 0.9 }],
                rationale: "Covered by matching wording in one CV block.",
              },
              {
                requirementId: "r-2",
                status: "covered",
                basis: "protected-rule",
                evidence: [],
                rationale: "Covered under the strict degree rule.",
              },
              {
                requirementId: "r-3",
                status: "needs-judgement",
                basis: "semantic-candidate",
                evidence: [{ blockId: "b-3" }],
                rationale: "Candidate awaiting judgement.",
              },
              {
                requirementId: "r-4",
                status: "uncovered",
                basis: "judgement",
                evidence: [],
                rationale: "The block does not show the skill.",
              },
              {
                requirementId: "r-5",
                status: "explicit-gap",
                basis: "lexical",
                evidence: [],
                rationale: "Marked as an explicit gap by the author.",
              },
            ],
          },
        }),
      ]),
    );

    expect(output).toEqual([
      "Requirement coverage (round 1):",
      "  [covered] r-1 — matching wording — Covered by matching wording in one CV block.",
      "    evidence: b-1, b-2",
      "  [covered] r-2 — strict rule — Covered under the strict degree rule.",
      "  [needs-judgement] r-3 — semantic candidate (needs judgement) — Candidate awaiting judgement.",
      "    evidence: b-3",
      "  [uncovered] r-4 — critic judgement — The block does not show the skill.",
      "  [explicit-gap] r-5 — matching wording — Marked as an explicit gap by the author.",
    ]);
  });

  it("uses the latest completed critic execution of the current round only", () => {
    const judged = (rationale: string): Record<string, unknown> => ({
      coverageJudgement: {
        instructionsVersion: null,
        summary,
        assessments: [
          {
            requirementId: "r-1",
            status: "covered",
            basis: "lexical",
            evidence: [],
            rationale,
          },
        ],
      },
    });
    const output = lines(
      snapshot(
        [
          execution({ id: "old-round", round: 1, ...judged("previous round") }),
          execution({ id: "first", round: 2, ...judged("first current") }),
          execution({ id: "latest", round: 2, ...judged("latest current") }),
          execution({ id: "failed", round: 2, status: "failed", ...judged("failed") }),
          execution({ id: "revision", round: 2, step: "revision", ...judged("revision") }),
        ],
        2,
      ),
    );

    expect(output).toEqual([
      "Requirement coverage (round 2):",
      "  [covered] r-1 — matching wording — latest current",
    ]);
  });
});
