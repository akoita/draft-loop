import { describe, expect, it } from "vitest";

import {
  evaluatePilotComparisonGate,
  type PilotComparisonGate,
  type PilotComparisonGateEvaluationInput,
  validatePilotComparisonGate,
  validatePilotComparisonMeasurements,
} from "./index.js";

const gate: PilotComparisonGate = {
  schemaVersion: 1,
  declaredAt: "2026-08-30T09:00:00.000Z",
  thresholds: {
    minimumRelevantAchievementRecall: 0.8,
    minimumCriticalRequirementCoverage: 0.75,
    maximumRevisedReviewMinutes: 10,
    maximumRevisedEditCount: 3,
  },
  invariants: {
    factualInvariantViolations: "zero-tolerance",
    unsupportedModelAddedClaims: "zero-tolerance",
  },
};

const passingInput: PilotComparisonGateEvaluationInput = {
  factualInvariantViolationCount: 0,
  requiredSectionsPreserved: true,
  chronologyPreserved: true,
  relevantAchievementRecall: 0.9,
  unsupportedModelAddedClaimCount: 0,
  criticalRequirementCoverage: 0.8,
  revisedReviewMinutes: 10,
  revisedEditCount: 3,
  revisedReady: true,
  approvalCompleted: true,
  exportCompleted: true,
};

const privateMeasurements = {
  factualInvariantViolationCount: 0,
  requiredSectionsPreserved: true,
  chronologyPreserved: true,
  relevantAchievementRecall: 0.9,
};

describe("pilot comparison gate", () => {
  it("validates the complete v1 contract and consent-to-first-draft order", () => {
    expect(() =>
      validatePilotComparisonGate(gate, {
        consentedAt: "2026-08-30T08:00:00.000Z",
        firstDraftCreatedAt: "2026-08-30T10:00:00.000Z",
      }),
    ).not.toThrow();

    expect(() =>
      validatePilotComparisonGate(gate, {
        consentedAt: "2026-08-30T09:01:00.000Z",
        firstDraftCreatedAt: "2026-08-30T10:00:00.000Z",
      }),
    ).toThrow(/timeline/);

    expect(() =>
      validatePilotComparisonGate(gate, {
        consentedAt: "2026-08-30T08:00:00.000Z",
        firstDraftCreatedAt: "2026-08-30T08:59:00.000Z",
      }),
    ).toThrow(/timeline/);

    expect(() => validatePilotComparisonGate({ ...gate, schemaVersion: 2 })).toThrow(/unsupported/);
    expect(() =>
      validatePilotComparisonGate({
        ...gate,
        thresholds: { ...gate.thresholds, maximumRevisedEditCount: -1 },
      }),
    ).toThrow(/edit-count/);
    expect(() =>
      validatePilotComparisonGate({
        ...gate,
        thresholds: { ...gate.thresholds, minimumRelevantAchievementRecall: 1.1 },
      }),
    ).toThrow(/between 0 and 1/);
    expect(() =>
      validatePilotComparisonGate({ ...gate, declaredAt: "2026-02-30T09:00:00.000Z" }),
    ).toThrow(/timestamp/);
    expect(() =>
      validatePilotComparisonGate({
        ...gate,
        invariants: {
          factualInvariantViolations: "allow-one",
          unsupportedModelAddedClaims: "zero-tolerance",
        },
      }),
    ).toThrow(/zero-tolerance/);
  });

  it("validates all required private measurements without exposing their values", () => {
    expect(() => validatePilotComparisonMeasurements(privateMeasurements)).not.toThrow();
    expect(() =>
      validatePilotComparisonMeasurements({
        factualInvariantViolationCount: 0,
        requiredSectionsPreserved: true,
        chronologyPreserved: true,
      }),
    ).toThrow(/incomplete/);
    expect(() =>
      validatePilotComparisonMeasurements({
        ...privateMeasurements,
        relevantAchievementRecall: 2,
      }),
    ).toThrow(/between 0 and 1/);
    expect(() =>
      validatePilotComparisonMeasurements({
        ...privateMeasurements,
        factualInvariantViolationCount: -1,
      }),
    ).toThrow(/violation count/);
  });

  it("passes all seven dimensions at inclusive thresholds", () => {
    const result = evaluatePilotComparisonGate(gate, passingInput);

    expect(result).toEqual({
      dimensions: {
        factualSafety: "pass",
        requiredSectionPreservation: "pass",
        chronologyPreservation: "pass",
        relevantAchievementRecall: "pass",
        criticalRequirementCoverage: "pass",
        boundedHumanReview: "pass",
        professionalReadiness: "pass",
      },
      overall: "pass",
    });
    expect(JSON.stringify(result)).not.toContain("2026-08-30T09:00:00.000Z");
    expect(JSON.stringify(result)).not.toContain("0.8");
  });

  it("fails deterministically on zero-tolerance, preservation, threshold, effort, and readiness violations", () => {
    const result = evaluatePilotComparisonGate(gate, {
      ...passingInput,
      factualInvariantViolationCount: 1,
      unsupportedModelAddedClaimCount: 1,
      requiredSectionsPreserved: false,
      chronologyPreserved: false,
      relevantAchievementRecall: 0.79,
      criticalRequirementCoverage: 0.74,
      revisedReviewMinutes: 11,
      revisedEditCount: 4,
      revisedReady: false,
      approvalCompleted: false,
      exportCompleted: false,
    });

    expect(result.overall).toBe("fail");
    expect(result.dimensions).toEqual({
      factualSafety: "fail",
      requiredSectionPreservation: "fail",
      chronologyPreservation: "fail",
      relevantAchievementRecall: "fail",
      criticalRequirementCoverage: "fail",
      boundedHumanReview: "fail",
      professionalReadiness: "fail",
    });
  });

  it("returns indeterminate for unavailable computed values", () => {
    const result = evaluatePilotComparisonGate(gate, {
      ...passingInput,
      unsupportedModelAddedClaimCount: null,
      criticalRequirementCoverage: null,
      revisedReviewMinutes: null,
      revisedEditCount: null,
    });

    expect(result.overall).toBe("indeterminate");
    expect(result.dimensions.factualSafety).toBe("indeterminate");
    expect(result.dimensions.criticalRequirementCoverage).toBe("indeterminate");
    expect(result.dimensions.boundedHumanReview).toBe("indeterminate");
  });
});
