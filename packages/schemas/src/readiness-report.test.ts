import { describe, expect, it } from "vitest";

import {
  independentReadinessReportEvaluationSchema,
  independentReadinessReportFindingSchema,
  independentReadinessReportInputAssessmentSchema,
  independentReadinessReportSchema,
  independentReadinessReportTargetSchema,
  readinessDimensions,
} from "./index.js";

function evaluation() {
  return {
    scores: readinessDimensions.map((dimension) => ({
      dimension,
      score: 0.8,
      rationale: `${dimension} score is supported by the supplied evaluation`,
    })),
    thresholdResults: readinessDimensions.map((dimension) => ({
      dimension,
      score: 0.8,
      threshold: 0.7,
      meets: true,
    })),
    meetsRubric: true,
  };
}

function finding(overrides: Record<string, unknown> = {}) {
  return {
    id: "finding-1",
    origin: "deterministic",
    code: "missing-required-section",
    category: "format",
    severity: "error",
    rationale: "A required section is absent.",
    target: { kind: "section", id: "section-summary" },
    recommendedAction: "Add the required section before approval.",
    confidence: 1,
    ...overrides,
  };
}

function report(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    contextSnapshotId: "context-1",
    artifact: { id: "artifact-1", version: 2 },
    createdAt: "2026-08-25T10:00:00.000Z",
    summary: "The report contains an independent review of the current artifact.",
    independentReview: {
      authorLineage: "anthropic:author",
      criticLineage: "openai:critic",
      lineagesDistinct: true,
      required: true,
    },
    inputAssessment: { status: "complete", missingInputs: [] },
    evaluation: evaluation(),
    findings: [finding()],
    ...overrides,
  };
}

describe("independent readiness report schemas", () => {
  it("accepts a complete report with all seven evaluated dimensions", () => {
    const parsed = independentReadinessReportSchema.parse(report());

    expect(parsed).toEqual(report());
    expect(parsed.evaluation.scores).toHaveLength(7);
    expect(parsed.evaluation.thresholdResults).toHaveLength(7);
  });

  it("rejects hidden chain-of-thought and raw provider fields", () => {
    expect(() =>
      independentReadinessReportSchema.parse({
        ...report(),
        chainOfThought: "hidden reasoning",
      }),
    ).toThrow();
    expect(() =>
      independentReadinessReportSchema.parse({
        ...report(),
        independentReview: {
          ...report().independentReview,
          rawResponse: "provider payload",
        },
      }),
    ).toThrow();
    expect(() =>
      independentReadinessReportSchema.parse({
        ...report(),
        findings: [finding({ rawPrompt: "provider prompt" })],
      }),
    ).toThrow();
    expect(() =>
      independentReadinessReportSchema.parse({
        ...report(),
        evaluation: {
          ...evaluation(),
          rawResponse: "provider payload",
        },
      }),
    ).toThrow();
  });

  it("constrains rubric targets to canonical dimensions and rejects empty ids", () => {
    expect(
      independentReadinessReportTargetSchema.parse({ kind: "rubric", id: "accuracy" }),
    ).toEqual({ kind: "rubric", id: "accuracy" });
    expect(
      independentReadinessReportTargetSchema.safeParse({ kind: "rubric", id: "claim-1" }).success,
    ).toBe(false);
    expect(
      independentReadinessReportTargetSchema.safeParse({ kind: "claim", id: "   " }).success,
    ).toBe(false);
    expect(
      independentReadinessReportTargetSchema.safeParse({
        kind: "section",
        id: "section-1",
        chainOfThought: "hidden reasoning",
      }).success,
    ).toBe(false);
  });

  it("enforces input assessment completeness and unique missing inputs", () => {
    expect(
      independentReadinessReportInputAssessmentSchema.safeParse({
        status: "complete",
        missingInputs: [],
      }).success,
    ).toBe(true);
    expect(
      independentReadinessReportInputAssessmentSchema.safeParse({
        status: "complete",
        missingInputs: ["rubric"],
      }).success,
    ).toBe(false);
    expect(
      independentReadinessReportInputAssessmentSchema.safeParse({
        status: "incomplete",
        missingInputs: [],
      }).success,
    ).toBe(false);
    expect(
      independentReadinessReportInputAssessmentSchema.safeParse({
        status: "incomplete",
        missingInputs: ["rubric", "rubric"],
      }).success,
    ).toBe(false);
  });

  it("requires every readiness dimension exactly once in each evaluation list", () => {
    const duplicateScores = evaluation().scores.map((score, index) =>
      index === 6 ? { ...score, dimension: "relevance" } : score,
    );
    const duplicateThresholds = evaluation().thresholdResults.map((result, index) =>
      index === 6 ? { ...result, dimension: "relevance" } : result,
    );

    expect(
      independentReadinessReportEvaluationSchema.safeParse({
        ...evaluation(),
        scores: duplicateScores,
      }).success,
    ).toBe(false);
    expect(
      independentReadinessReportEvaluationSchema.safeParse({
        ...evaluation(),
        thresholdResults: duplicateThresholds,
      }).success,
    ).toBe(false);
  });

  it("requires evaluation scores, thresholds, and rubric outcome to agree", () => {
    const mismatchedScore = evaluation().thresholdResults.map((result, index) =>
      index === 0 ? { ...result, score: 0.7 } : result,
    );
    const mismatchedMeets = evaluation().thresholdResults.map((result, index) =>
      index === 0 ? { ...result, meets: false } : result,
    );

    expect(
      independentReadinessReportEvaluationSchema.safeParse({
        ...evaluation(),
        thresholdResults: mismatchedScore,
      }).success,
    ).toBe(false);
    expect(
      independentReadinessReportEvaluationSchema.safeParse({
        ...evaluation(),
        thresholdResults: mismatchedMeets,
      }).success,
    ).toBe(false);
    expect(
      independentReadinessReportEvaluationSchema.safeParse({
        ...evaluation(),
        meetsRubric: false,
      }).success,
    ).toBe(false);
  });

  it("requires globally unique finding ids", () => {
    expect(
      independentReadinessReportSchema.safeParse({
        ...report(),
        findings: [finding(), finding({ origin: "critic" })],
      }).success,
    ).toBe(false);
  });

  it("binds artifact finding targets to the report artifact identity", () => {
    expect(
      independentReadinessReportSchema.safeParse({
        ...report(),
        findings: [finding({ target: { kind: "artifact", id: "artifact-other" } })],
      }).success,
    ).toBe(false);
  });

  it("enforces finding bounds and strict nested objects", () => {
    expect(
      independentReadinessReportFindingSchema.safeParse(finding({ rationale: "x".repeat(401) }))
        .success,
    ).toBe(false);
    expect(
      independentReadinessReportFindingSchema.safeParse(finding({ confidence: 1.1 })).success,
    ).toBe(false);
    expect(
      independentReadinessReportFindingSchema.safeParse(
        finding({ target: { kind: "rubric", id: "relevance", rawResponse: "secret" } }),
      ).success,
    ).toBe(false);
  });
});
