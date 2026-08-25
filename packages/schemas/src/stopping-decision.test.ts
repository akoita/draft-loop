import { describe, expect, it } from "vitest";

import {
  applicationReadinessStoppingDecisionBlockerSchema,
  applicationReadinessStoppingDecisionLimitationSchema,
  applicationReadinessStoppingDecisionSchema,
  applicationReadinessStoppingLoopContextSchema,
  readinessDimensionAgreementSchema,
  readinessDimensions,
} from "./index.js";

function evaluation() {
  return {
    scores: readinessDimensions.map((dimension) => ({
      dimension,
      score: 0.9,
      rationale: `The ${dimension} score is supported by the review.`,
    })),
    thresholdResults: readinessDimensions.map((dimension) => ({
      dimension,
      score: 0.9,
      threshold: 0.8,
      meets: true,
    })),
    meetsRubric: true,
  };
}

function report(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    contextSnapshotId: "context-1",
    artifact: { id: "artifact-1", version: 1 },
    createdAt: "2026-08-26T10:05:00.000Z",
    summary: "The artifact was reviewed against the supplied application rubric.",
    independentReview: {
      authorLineage: "anthropic:author",
      criticLineage: "openai:critic",
      lineagesDistinct: true,
      required: true,
    },
    inputAssessment: { status: "complete", missingInputs: [] },
    evaluation: evaluation(),
    findings: [],
    ...overrides,
  };
}

function agreements() {
  return readinessDimensions.map((dimension) => ({
    dimension,
    status: "agreed" as const,
    rationale: `The independent review agrees on ${dimension}.`,
  }));
}

function decision(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    contextSnapshotId: "context-1",
    artifact: {
      id: "artifact-1",
      version: 1,
      createdAt: "2026-08-26T10:00:00.000Z",
      parentVersionId: null,
    },
    createdAt: "2026-08-26T10:10:00.000Z",
    report: report(),
    deterministicChecks: [],
    agreements: agreements(),
    blockers: [],
    limitations: [],
    loopContext: {
      round: 1,
      maxRounds: 3,
      stable: false,
      budgetExhausted: false,
      cancelled: false,
    },
    applicationReady: true,
    shouldStop: true,
    bestAvailable: false,
    stopReason: "application-ready",
    humanApprovalRequired: true,
    ...overrides,
  };
}

describe("application-readiness stopping decision schemas", () => {
  it("requires all seven dimension agreements in canonical order", () => {
    const parsed = applicationReadinessStoppingDecisionSchema.parse(decision());
    expect(parsed.agreements.map((agreement) => agreement.dimension)).toEqual(readinessDimensions);

    expect(
      applicationReadinessStoppingDecisionSchema.safeParse(
        decision({
          agreements: [agreements()[1], agreements()[0], ...agreements().slice(2)],
        }),
      ).success,
    ).toBe(false);
    expect(
      readinessDimensionAgreementSchema.safeParse({
        dimension: "relevance",
        status: "agreed",
        rationale: " ",
      }).success,
    ).toBe(false);
    expect(
      readinessDimensionAgreementSchema.safeParse({
        dimension: "relevance",
        status: "agreed",
        rationale: "r".repeat(501),
      }).success,
    ).toBe(false);
  });

  it("keeps deterministic checks content-free and rejects unknown provider fields", () => {
    expect(
      applicationReadinessStoppingDecisionSchema.safeParse(
        decision({
          deterministicChecks: [
            {
              code: "unsupported-claim",
              severity: "error",
              category: "evidence",
              claimId: "claim-1",
              message: "source text must not cross this boundary",
            },
          ],
          blockers: [
            {
              code: "deterministic-error",
              checkCode: "unsupported-claim",
              claimId: "claim-1",
            },
          ],
          applicationReady: false,
          shouldStop: true,
          bestAvailable: true,
          stopReason: "max-rounds",
        }),
      ).success,
    ).toBe(false);
    expect(
      applicationReadinessStoppingDecisionSchema.safeParse(
        decision({ chainOfThought: "hidden reasoning" }),
      ).success,
    ).toBe(false);
    expect(
      applicationReadinessStoppingDecisionSchema.safeParse(
        decision({ report: report({ rawResponse: "provider payload" }) }),
      ).success,
    ).toBe(false);
  });

  it("checks artifact/context/trace identity and chronology", () => {
    expect(
      applicationReadinessStoppingDecisionSchema.safeParse(
        decision({ artifact: { id: "other-artifact", version: 1 } }),
      ).success,
    ).toBe(false);
    expect(
      applicationReadinessStoppingDecisionSchema.safeParse(
        decision({ contextSnapshotId: "other-context" }),
      ).success,
    ).toBe(false);
    expect(
      applicationReadinessStoppingDecisionSchema.safeParse(
        decision({ createdAt: "2026-08-26T10:00:00.000Z" }),
      ).success,
    ).toBe(false);
  });

  it("requires derived fields to agree with blockers and the stop reason", () => {
    const blocker = { code: "report-error" as const, findingId: "finding-1" };
    expect(
      applicationReadinessStoppingDecisionSchema.safeParse(
        decision({
          blockers: [blocker],
          applicationReady: true,
        }),
      ).success,
    ).toBe(false);
    expect(
      applicationReadinessStoppingDecisionSchema.safeParse(
        decision({
          blockers: [blocker],
          applicationReady: false,
          shouldStop: true,
          bestAvailable: true,
          stopReason: "continue",
        }),
      ).success,
    ).toBe(false);
    expect(
      applicationReadinessStoppingDecisionSchema.safeParse(
        decision({ humanApprovalRequired: false }),
      ).success,
    ).toBe(false);
  });

  it("rejects duplicate blockers, limitations, and deterministic checks", () => {
    const check = {
      code: "unsupported-claim",
      severity: "error",
      category: "evidence",
      claimId: "claim-1",
    };
    expect(
      applicationReadinessStoppingDecisionSchema.safeParse(
        decision({ deterministicChecks: [check, check] }),
      ).success,
    ).toBe(false);
    expect(
      applicationReadinessStoppingDecisionSchema.safeParse(
        decision({
          blockers: [
            { code: "report-error", findingId: "finding-1" },
            { code: "report-error", findingId: "finding-1" },
          ],
          applicationReady: false,
          bestAvailable: true,
          stopReason: "continue",
          shouldStop: false,
        }),
      ).success,
    ).toBe(false);
    expect(
      applicationReadinessStoppingDecisionSchema.safeParse(
        decision({
          limitations: [
            { code: "report-warning", findingId: "finding-1" },
            { code: "report-warning", findingId: "finding-1" },
          ],
        }),
      ).success,
    ).toBe(false);
  });

  it("derives blocker coverage instead of trusting fabricated ready fields", () => {
    const incompleteReport = report({
      inputAssessment: { status: "incomplete", missingInputs: ["evidence"] },
    });
    const failedReviewReport = report({
      independentReview: {
        authorLineage: "anthropic:author",
        criticLineage: "anthropic:author",
        lineagesDistinct: false,
        required: true,
      },
    });
    const errorReport = report({
      findings: [
        {
          id: "finding-1",
          origin: "critic",
          code: "unsupported-claim",
          category: "evidence",
          severity: "error",
          rationale: "The claim needs evidence.",
          target: { kind: "claim", id: "claim-1" },
          recommendedAction: "Add evidence.",
          confidence: 0.9,
        },
      ],
    });
    const unmetReport = report({
      evaluation: {
        ...evaluation(),
        thresholdResults: readinessDimensions.map((dimension, index) => ({
          dimension,
          score: index === 0 ? 0.2 : 0.9,
          threshold: 0.8,
          meets: index !== 0,
        })),
        meetsRubric: false,
      },
    });
    const disputedAgreements = agreements().map((agreement, index) =>
      index === 0 ? { ...agreement, status: "disputed" as const } : agreement,
    );

    for (const overrides of [
      { report: incompleteReport },
      { report: failedReviewReport },
      { report: errorReport },
      { report: unmetReport },
      { agreements: disputedAgreements },
    ]) {
      expect(
        applicationReadinessStoppingDecisionSchema.safeParse(
          decision({ applicationReady: true, ...overrides }),
        ).success,
      ).toBe(false);
    }
  });

  it("requires code-specific references and exact derived reference sets", () => {
    expect(
      applicationReadinessStoppingDecisionBlockerSchema.safeParse({
        code: "independent-review-incomplete",
        findingId: "finding-1",
      }).success,
    ).toBe(false);
    expect(
      applicationReadinessStoppingDecisionBlockerSchema.safeParse({
        code: "deterministic-error",
        checkCode: "unsupported-claim",
        dimension: "evidence",
      }).success,
    ).toBe(false);
    expect(
      applicationReadinessStoppingDecisionLimitationSchema.safeParse({
        code: "revision-effect-overridden",
        findingId: "finding-1",
        requirementId: "requirement-1",
      }).success,
    ).toBe(false);

    const findingReport = report({
      findings: [
        {
          id: "finding-1",
          origin: "critic",
          code: "unsupported-claim",
          category: "evidence",
          severity: "error",
          rationale: "The claim needs evidence.",
          target: { kind: "claim", id: "claim-1" },
          recommendedAction: "Add evidence.",
          confidence: 0.9,
        },
      ],
    });
    expect(
      applicationReadinessStoppingDecisionSchema.safeParse(
        decision({
          report: findingReport,
          blockers: [{ code: "report-error", findingId: "finding-1", dimension: "relevance" }],
          applicationReady: false,
          bestAvailable: true,
          stopReason: "continue",
          shouldStop: false,
        }),
      ).success,
    ).toBe(false);
  });

  it("derives stop state from strict loop context precedence", () => {
    expect(
      applicationReadinessStoppingLoopContextSchema.safeParse({
        round: 0,
        maxRounds: 3,
        stable: false,
        budgetExhausted: false,
        cancelled: false,
      }).success,
    ).toBe(false);
    expect(
      applicationReadinessStoppingLoopContextSchema.safeParse({
        round: Number.MAX_SAFE_INTEGER + 1,
        maxRounds: 3,
        stable: false,
        budgetExhausted: false,
        cancelled: false,
      }).success,
    ).toBe(false);
    expect(
      applicationReadinessStoppingDecisionSchema.safeParse(
        decision({
          loopContext: {
            round: 1,
            maxRounds: 3,
            stable: true,
            budgetExhausted: true,
            cancelled: true,
          },
          stopReason: "stable-convergence",
          shouldStop: true,
          bestAvailable: true,
        }),
      ).success,
    ).toBe(false);
  });

  it("requires canonical deterministic check ordering", () => {
    const checks = [
      { code: "z-check", severity: "warning" as const, category: "quality" as const },
      { code: "a-check", severity: "warning" as const, category: "quality" as const },
    ];
    const sortedChecks = [...checks].reverse();
    const sortedLimitations = sortedChecks.map((check) => ({
      code: "deterministic-warning" as const,
      checkCode: check.code,
    }));
    expect(
      applicationReadinessStoppingDecisionSchema.safeParse(
        decision({ deterministicChecks: sortedChecks, limitations: sortedLimitations }),
      ).success,
    ).toBe(true);
    expect(
      applicationReadinessStoppingDecisionSchema.safeParse(
        decision({ deterministicChecks: checks, limitations: sortedLimitations }),
      ).success,
    ).toBe(false);
  });
});
