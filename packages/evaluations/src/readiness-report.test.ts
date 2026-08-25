import type {
  IndependentReadinessReportFindingInput,
  IndependentReadinessReportInputAssessment,
  IndependentReview,
} from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";
import {
  buildIndependentReadinessReport,
  type IndependentReadinessEvaluationProjection,
  readinessDimensions,
} from "./index.js";

const independentReview: IndependentReview = {
  authorLineage: "anthropic:author-v1",
  criticLineage: "openai:critic-v1",
  lineagesDistinct: true,
  required: true,
};

const inputAssessment: IndependentReadinessReportInputAssessment = {
  status: "complete",
  missingInputs: [],
};

const evaluation: IndependentReadinessEvaluationProjection = {
  scores: readinessDimensions.map((dimension) => ({
    dimension,
    score: 0.75,
    rationale: `supplied rationale for ${dimension}`,
  })),
  thresholdResults: readinessDimensions.map((dimension) => ({
    dimension,
    score: 0.75,
    threshold: 0.7,
    meets: true,
  })),
  meetsRubric: true,
};

function finding(
  id: string,
  severity: "error" | "warning",
  category: IndependentReadinessReportFindingInput["category"] = "quality",
): IndependentReadinessReportFindingInput {
  return {
    id,
    code: `code-${id}`,
    category,
    severity,
    rationale: `rationale supplied for ${id}`,
    target: { kind: "claim", id: `claim-${id}` },
    recommendedAction: `action supplied for ${id}`,
    confidence: 0.61,
  };
}

function input(
  overrides: Partial<{
    readonly metadata: {
      readonly contextSnapshotId: string;
      readonly artifact: { readonly id: string; readonly version: number };
      readonly createdAt: string;
    };
    readonly summary: string;
    readonly independentReview: IndependentReview;
    readonly inputAssessment: IndependentReadinessReportInputAssessment;
    readonly evaluation: IndependentReadinessEvaluationProjection;
    readonly deterministicFindings: readonly IndependentReadinessReportFindingInput[];
    readonly criticFindings: readonly IndependentReadinessReportFindingInput[];
  }> = {},
) {
  return {
    metadata: {
      contextSnapshotId: "context-1",
      artifact: { id: "artifact-1", version: 2 },
      createdAt: "2026-08-25T10:00:00.000Z",
    },
    summary: "The supplied independent review is traceable and bounded.",
    independentReview,
    inputAssessment,
    evaluation,
    deterministicFindings: [
      finding("d-z", "error"),
      finding("d-a", "error"),
      finding("d-w", "warning"),
    ],
    criticFindings: [finding("c-a", "error"), finding("c-w", "warning")],
    ...overrides,
  };
}

describe("independent readiness report assembly", () => {
  it("assigns provenance and orders findings deterministically", () => {
    const report = buildIndependentReadinessReport(input());

    expect(report.findings.map((finding) => [finding.origin, finding.id])).toEqual([
      ["deterministic", "d-a"],
      ["deterministic", "d-z"],
      ["critic", "c-a"],
      ["deterministic", "d-w"],
      ["critic", "c-w"],
    ]);
    expect(report.findings[0]).toMatchObject({
      code: "code-d-a",
      rationale: "rationale supplied for d-a",
      target: { kind: "claim", id: "claim-d-a" },
      recommendedAction: "action supplied for d-a",
      confidence: 0.61,
    });
  });

  it("preserves the evaluation projection without deriving readiness decisions", () => {
    const report = buildIndependentReadinessReport(input());

    expect(report.evaluation).toEqual(evaluation);
    expect(report).not.toHaveProperty("ready");
    expect(report).not.toHaveProperty("status");
    expect(report).not.toHaveProperty("stopReason");
    expect(report).not.toHaveProperty("shouldStop");
    expect(report).not.toHaveProperty("scoreVector");
    expect(report).not.toHaveProperty("rubric");
  });

  it("returns a deeply immutable report and does not mutate finding inputs", () => {
    const source = input();
    const sourceFinding = source.deterministicFindings[0];
    const report = buildIndependentReadinessReport(source);

    expect(report).not.toBe(source);
    expect(sourceFinding).toEqual(finding("d-z", "error"));
    expect(Object.isFrozen(report)).toBe(true);
    expect(Object.isFrozen(report.artifact)).toBe(true);
    expect(Object.isFrozen(report.independentReview)).toBe(true);
    expect(Object.isFrozen(report.inputAssessment)).toBe(true);
    expect(Object.isFrozen(report.evaluation)).toBe(true);
    expect(Object.isFrozen(report.evaluation.scores)).toBe(true);
    expect(Object.isFrozen(report.evaluation.scores[0])).toBe(true);
    expect(Object.isFrozen(report.evaluation.thresholdResults)).toBe(true);
    expect(Object.isFrozen(report.findings)).toBe(true);
    expect(Object.isFrozen(report.findings[0])).toBe(true);
    expect(Object.isFrozen(report.findings[0]?.target)).toBe(true);
  });

  it("rejects duplicate finding ids and hidden provider fields through the schema", () => {
    expect(() =>
      buildIndependentReadinessReport(
        input({
          criticFindings: [finding("d-z", "warning")],
        }),
      ),
    ).toThrow();

    expect(() =>
      buildIndependentReadinessReport(
        input({
          deterministicFindings: [
            { ...finding("hidden", "error"), rawResponse: "provider payload" } as never,
          ],
        }),
      ),
    ).toThrow();
  });
});
