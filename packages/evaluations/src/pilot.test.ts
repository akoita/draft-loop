import type { DraftArtifact } from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";

import {
  type ConsentedPilotCase,
  type PilotConsentRecord,
  type PilotOutcomeRecord,
  type ReadinessEvaluationContext,
  runConsentedPilotHarness,
  validatePilotCohortDeclaration,
  validatePilotConsent,
  validatePilotOutcome,
} from "./index.js";

const context: ReadinessEvaluationContext = {
  requirements: [
    { id: "req-1", text: "TypeScript distributed systems", priority: "critical" },
    { id: "req-2", text: "SQLite database storage", priority: "critical" },
  ],
  outputConstraints: { requiredSections: ["Summary", "Experience"] },
  readinessRubric: {
    relevance: 0.7,
    evidence: 0.7,
    accuracy: 0.7,
    differentiation: 0.7,
    clarity: 0.7,
    format: 0.7,
    credibility: 0.7,
  },
};

function artifact(id: string, full = true): DraftArtifact {
  return {
    schemaVersion: 1,
    id,
    version: 1,
    parentVersionId: null,
    createdAt: "2026-08-13T10:00:00.000Z",
    language: "en",
    sections: [
      {
        id: `${id}-sec-1`,
        title: "Summary",
        kind: "summary",
        order: 0,
        blocks: [
          {
            id: `${id}-blk-1`,
            type: "paragraph",
            text: "TypeScript distributed systems.",
            claimIds: [`${id}-claim-1`],
          },
        ],
      },
      ...(full
        ? [
            {
              id: `${id}-sec-2`,
              title: "Experience",
              kind: "experience" as const,
              order: 1,
              blocks: [
                {
                  id: `${id}-blk-2`,
                  type: "paragraph" as const,
                  text: "SQLite database storage.",
                  claimIds: [`${id}-claim-2`],
                },
              ],
            },
          ]
        : []),
    ],
    claims: [
      {
        id: `${id}-claim-1`,
        text: "TypeScript distributed systems.",
        sectionId: `${id}-sec-1`,
        blockId: `${id}-blk-1`,
        substantive: true,
        status: "verified",
        evidence: [
          {
            sourcePath: "/local/resume.md",
            excerpt: "TypeScript distributed systems.",
          },
        ],
      },
      ...(full
        ? [
            {
              id: `${id}-claim-2`,
              text: "SQLite database storage.",
              sectionId: `${id}-sec-2`,
              blockId: `${id}-blk-2`,
              substantive: true,
              status: "verified" as const,
              evidence: [
                {
                  sourcePath: "/local/resume.md",
                  excerpt: "SQLite database storage.",
                },
              ],
            },
          ]
        : []),
    ],
    decisions: [],
  };
}

const consent: PilotConsentRecord = {
  candidateId: "candidate-sanitized-1",
  consentedAt: "2026-08-13T08:00:00.000Z",
  sanitizationCompleted: true,
  piiRedacted: true,
  employerSecretsRedacted: true,
  allowAnonymizedBenchmarking: true,
};

const outcome: PilotOutcomeRecord = {
  approvalCompleted: true,
  exportCompleted: true,
  exportFormats: ["markdown", "pdf"],
  rounds: 2,
  providerCostUsd: 0.04,
  userConfidence: 4,
  misleadingEvidence: "not-observed",
  promptInjection: "not-observed",
  limitations: ["single-consented-case", "adversarial-observation-unavailable"],
};

const comparisonGate = {
  schemaVersion: 1 as const,
  declaredAt: "2026-08-13T09:17:31.456Z",
  thresholds: {
    minimumRelevantAchievementRecall: 0.8765,
    minimumCriticalRequirementCoverage: 0.9345,
    maximumRevisedReviewMinutes: 9.25,
    maximumRevisedEditCount: 5,
  },
};

const comparisonMeasurements = {
  factualInvariantViolationCount: 0,
  requiredSectionsPreserved: true,
  chronologyPreserved: true,
  relevantAchievementRecall: 0.9876,
};

const cohortDeclaration = {
  schemaVersion: 1 as const,
  declaredAt: "2026-08-13T09:00:00.000Z",
  minimumCaseCount: 2,
};

const pilotCase: ConsentedPilotCase = {
  id: "pilot-case-1",
  context,
  consent,
  firstDraft: artifact("first", false),
  revisedDraft: artifact("revised", true),
  manualBaseline: artifact("manual", true),
  userEffort: {
    "first-draft": { reviewMinutes: 15, editCount: 6, approvalCount: 0 },
    "revised-draft": { reviewMinutes: 8, editCount: 2, approvalCount: 1 },
    "manual-baseline": { reviewMinutes: 25, editCount: 12, approvalCount: 1 },
  },
  findingsDisposition: {
    usefulCount: 4,
    rejectedCount: 1,
  },
};

describe("Consented Real-Application Pilot Harness", () => {
  it("rejects an empty pilot case list", () => {
    expect(() => runConsentedPilotHarness([])).toThrow("at least one case");
  });

  it("enforces complete consent and sanitization verification", () => {
    expect(() => validatePilotConsent(consent)).not.toThrow();

    expect(() => validatePilotConsent({ ...consent, sanitizationCompleted: false })).toThrow(
      /sanitization/,
    );

    expect(() => validatePilotConsent({ ...consent, piiRedacted: false })).toThrow(/sanitization/);

    expect(() => validatePilotConsent({ ...consent, allowAnonymizedBenchmarking: false })).toThrow(
      /sanitization/,
    );
  });

  it("validates explicit content-free outcome measurements", () => {
    expect(() => validatePilotOutcome(outcome)).not.toThrow();
    expect(() => validatePilotOutcome({ ...outcome, rounds: 0 })).toThrow(/rounds/);
    expect(() => validatePilotOutcome({ ...outcome, exportCompleted: false })).toThrow(
      /incomplete pilot export/,
    );
    expect(() => validatePilotOutcome({ ...outcome, userConfidence: 6 })).toThrow(/confidence/);
  });

  it("validates the strict v1 cohort declaration and every first-draft timestamp", () => {
    expect(() =>
      validatePilotCohortDeclaration(cohortDeclaration, [pilotCase.firstDraft.createdAt]),
    ).not.toThrow();
    expect(() => validatePilotCohortDeclaration(undefined)).toThrow(/cohort declaration/);
    expect(() =>
      validatePilotCohortDeclaration({ ...cohortDeclaration, schemaVersion: 2 }),
    ).toThrow(/unsupported/);
    expect(() =>
      validatePilotCohortDeclaration({ ...cohortDeclaration, declaredAt: "2026-02-30T09:00:00Z" }),
    ).toThrow(/timestamp/);
    expect(() =>
      validatePilotCohortDeclaration(
        { ...cohortDeclaration, declaredAt: "2026-08-13T11:00:00.000Z" },
        [pilotCase.firstDraft.createdAt],
      ),
    ).toThrow(/after/);
    expect(() =>
      validatePilotCohortDeclaration({ ...cohortDeclaration, minimumCaseCount: 1 }),
    ).toThrow(/greater than 1/);
    expect(() =>
      validatePilotCohortDeclaration({ ...cohortDeclaration, minimumCaseCount: 1_001 }),
    ).toThrow(/no greater/);
    expect(() => validatePilotCohortDeclaration({ ...cohortDeclaration, extra: true })).toThrow(
      /unsupported fields/,
    );
  });

  it("runs comparative tri-variant evaluation and generates a zero-leakage pilot report", () => {
    const report = runConsentedPilotHarness([pilotCase]);

    expect(report.caseCount).toBe(1);
    expect(report.variants["first-draft"].averageReadinessRate).toBe(0);
    expect(report.variants["revised-draft"].averageReadinessRate).toBe(1);
    expect(report.variants["manual-baseline"].averageReadinessRate).toBe(1);

    expect(report.variants["revised-draft"].averageReviewMinutes).toBe(8);
    expect(report.variants["manual-baseline"].averageReviewMinutes).toBe(25);

    expect(report.criticEfficiency.totalUsefulFindings).toBe(4);
    expect(report.criticEfficiency.totalRejectedFindings).toBe(1);
    expect(report.criticEfficiency.usefulFindingRatio).toBe(0.8);

    expect(report.hypothesisValidation.factualityPreservedOrImproved).toBe("pass");
    expect(report.hypothesisValidation.effortReducedComparedToManual).toBe("pass");

    // Markdown report verification
    expect(report.markdownReport).toContain("Real-Application Consented Pilot Summary Report");
    expect(report.markdownReport).toContain("Tri-Variant Quality & Effort Comparison");
    expect(report.markdownReport).toContain("**Useful Finding Ratio:** 80.0%");
    expect(report.markdownReport).toContain("not independently verified by this harness");
    expect(report.markdownReport).not.toContain("candidate-sanitized-1");
    expect(report.outcomeValidation).toBe("indeterminate");
    expect(report.productMeasures.outcomeCaseCount).toBe(0);
    expect(report.productMeasures.variants["first-draft"].criticalRequirementCoverage).toBe(0.5);
    expect(report.productMeasures.variants["revised-draft"].criticalRequirementCoverage).toBe(1);
    expect(report.markdownReport).toContain(
      "synthetic or fixture results are not real-application evidence",
    );
  });

  it("requires private scope and completion measurements for an outcome validation", () => {
    const consentedCase: ConsentedPilotCase = {
      ...pilotCase,
      consent: { ...consent, reportingScope: "private-only" },
      outcome,
      comparisonGate,
      comparisonMeasurements,
    };
    const report = runConsentedPilotHarness([consentedCase], {
      requireOutcome: true,
      cohortDeclaration,
    });

    expect(report.outcomeValidation).toBe("fail");
    expect(report.cohortValidation).toEqual({
      status: "fail",
      reasonCodes: ["insufficient-cases"],
    });
    expect(report.comparisonGate.overall).toBe("pass");
    expect(report.comparisonGate.dimensions).toEqual({
      factualSafety: "pass",
      requiredSectionPreservation: "pass",
      chronologyPreservation: "pass",
      relevantAchievementRecall: "pass",
      criticalRequirementCoverage: "pass",
      boundedHumanReview: "pass",
      professionalReadiness: "pass",
    });
    expect(report.productMeasures.outcomeCaseCount).toBe(1);
    expect(report.productMeasures.approvalCompletionRate).toBe(1);
    expect(report.productMeasures.exportCompletionRate).toBe(1);
    expect(report.productMeasures.totalProviderCostUsd).toBe(0.04);
    expect(report.productMeasures.averageUserConfidence).toBe(4);
    expect(report.productMeasures.promptInjection["not-observed"]).toBe(1);
    expect(report.productMeasures.limitations["single-consented-case"]).toBe(1);
    expect(report.markdownReport).toContain("**Outcome validation:** FAIL");
    expect(report.markdownReport).toContain("**Status:** FAIL");
    expect(report.markdownReport).toContain("insufficient-cases");
    expect(report.markdownReport).toContain("## Predeclared comparison gate");
    expect(report.markdownReport).toContain("**Overall:** PASS");
    expect(report.markdownReport).toContain("single-consented-case (1)");
    expect(report.markdownReport).not.toContain("pilot-case-1");
    expect(report.markdownReport).not.toContain(comparisonGate.declaredAt);
    expect(report.markdownReport).not.toContain(
      String(comparisonGate.thresholds.minimumRelevantAchievementRecall),
    );
    expect(report.markdownReport).not.toContain(
      String(comparisonGate.thresholds.minimumCriticalRequirementCoverage),
    );
    expect(report.markdownReport).not.toContain(
      String(comparisonGate.thresholds.maximumRevisedReviewMinutes),
    );
    expect(report.markdownReport).not.toContain(
      String(comparisonMeasurements.relevantAchievementRecall),
    );
    expect(report.markdownReport).not.toContain("minimumRelevantAchievementRecall");
    expect(report.markdownReport).not.toContain("factualInvariantViolationCount");
  });

  it("passes a deterministic multi-case cohort and exposes only bounded cohort output", () => {
    const firstCase: ConsentedPilotCase = {
      ...pilotCase,
      consent: { ...consent, reportingScope: "private-only" },
      outcome,
      comparisonGate,
      comparisonMeasurements,
    };
    const secondCase: ConsentedPilotCase = {
      ...firstCase,
      id: "pilot-case-2-private-id",
      consent: { ...firstCase.consent, candidateId: "candidate-sanitized-2" },
      firstDraft: artifact("first-2", false),
      revisedDraft: artifact("revised-2", true),
      manualBaseline: artifact("manual-2", true),
    };
    const report = runConsentedPilotHarness([firstCase, secondCase], {
      requireOutcome: true,
      cohortDeclaration,
    });

    expect(report.outcomeValidation).toBe("pass");
    expect(report.cohortValidation).toEqual({ status: "pass", reasonCodes: [] });
    expect(report.markdownReport).toContain("**Status:** PASS");
    expect(report.markdownReport).toContain("**Reason codes:** none");
    expect(report.markdownReport).not.toContain(cohortDeclaration.declaredAt);
    expect(report.markdownReport).not.toContain("pilot-case-2-private-id");
    expect(report.markdownReport).not.toContain("candidate-sanitized-2");
  });

  it("keeps every fixed cohort rule fail-closed", () => {
    const baseCase: ConsentedPilotCase = {
      ...pilotCase,
      consent: { ...consent, reportingScope: "private-only" },
      outcome,
      comparisonGate,
      comparisonMeasurements,
    };
    const secondCase: ConsentedPilotCase = {
      ...baseCase,
      id: "pilot-case-2",
      consent: { ...baseCase.consent, candidateId: "candidate-sanitized-2" },
    };
    const run = (cases: readonly ConsentedPilotCase[]) =>
      runConsentedPilotHarness(cases, { requireOutcome: true, cohortDeclaration });

    expect(
      run([
        { ...baseCase, firstDraft: artifact("same-first"), revisedDraft: artifact("same-revised") },
        {
          ...secondCase,
          firstDraft: artifact("same-first-2"),
          revisedDraft: artifact("same-revised-2"),
        },
      ]).cohortValidation.reasonCodes,
    ).toContain("quality-not-improved");

    expect(
      run([{ ...baseCase, outcome: { ...outcome, approvalCompleted: false } }, secondCase])
        .cohortValidation.reasonCodes,
    ).toContain("outcome-not-complete");

    expect(
      run([
        {
          ...baseCase,
          userEffort: {
            ...baseCase.userEffort,
            "revised-draft": { reviewMinutes: 25, editCount: 2, approvalCount: 1 },
          },
        },
        {
          ...secondCase,
          userEffort: {
            ...secondCase.userEffort,
            "revised-draft": { reviewMinutes: 25, editCount: 2, approvalCount: 1 },
          },
        },
      ]).cohortValidation.reasonCodes,
    ).toContain("effort-reduction-not-demonstrated");

    expect(
      run([
        {
          ...baseCase,
          comparisonMeasurements: { ...comparisonMeasurements, relevantAchievementRecall: 0 },
        },
        secondCase,
      ]).cohortValidation.reasonCodes,
    ).toContain("comparison-gate-not-passing");

    const regressed = artifact("regressed", true);
    const unsupportedClaim = regressed.claims[0];
    if (unsupportedClaim === undefined) throw new Error("Expected a fixture claim.");
    expect(
      run([
        {
          ...baseCase,
          firstDraft: artifact("strong-first", true),
          revisedDraft: {
            ...regressed,
            claims: [
              { ...unsupportedClaim, status: "unverified", evidence: [] },
              ...regressed.claims.slice(1),
            ],
          },
        },
        secondCase,
      ]).cohortValidation.reasonCodes,
    ).toContain("factuality-regressed");
  });

  it("requires completed adversarial observations from every cohort case", () => {
    const baseCase: ConsentedPilotCase = {
      ...pilotCase,
      consent: { ...consent, reportingScope: "private-only" },
      outcome,
      comparisonGate,
      comparisonMeasurements,
    };
    const secondCase: ConsentedPilotCase = {
      ...baseCase,
      id: "pilot-case-2",
      consent: { ...baseCase.consent, candidateId: "candidate-sanitized-2" },
      firstDraft: artifact("first-2", false),
      revisedDraft: artifact("revised-2", true),
      manualBaseline: artifact("manual-2", true),
    };
    const run = (cases: readonly ConsentedPilotCase[]) =>
      runConsentedPilotHarness(cases, { requireOutcome: true, cohortDeclaration });

    const misleadingUntested = run([
      {
        ...baseCase,
        outcome: { ...outcome, misleadingEvidence: "not-tested" },
      },
      secondCase,
    ]);
    expect(misleadingUntested.cohortValidation).toEqual({
      status: "indeterminate",
      reasonCodes: ["misleading-evidence-not-tested"],
    });

    const promptInjectionUntested = run([
      baseCase,
      {
        ...secondCase,
        outcome: { ...outcome, promptInjection: "not-tested" },
      },
    ]);
    expect(promptInjectionUntested.cohortValidation).toEqual({
      status: "indeterminate",
      reasonCodes: ["prompt-injection-not-tested"],
    });

    const completed = run([
      { ...baseCase, outcome: { ...outcome, misleadingEvidence: "observed" } },
      { ...secondCase, outcome: { ...outcome, promptInjection: "observed" } },
    ]);
    expect(completed.cohortValidation).toEqual({ status: "pass", reasonCodes: [] });
    expect(completed.markdownReport).not.toContain("candidate-sanitized-2");
  });

  it("does not accept an outcome case without a private reporting scope", () => {
    expect(() =>
      runConsentedPilotHarness([{ ...pilotCase, outcome }], {
        requireOutcome: true,
        cohortDeclaration,
      }),
    ).toThrow(/reporting scope/);
  });

  it("requires a predeclared comparison gate and private measurements before evaluation", () => {
    expect(() =>
      runConsentedPilotHarness(
        [
          {
            ...pilotCase,
            consent: { ...consent, reportingScope: "private-only" },
            outcome,
          },
        ],
        { requireOutcome: true, cohortDeclaration },
      ),
    ).toThrow(/comparison gate/);

    expect(() =>
      runConsentedPilotHarness(
        [
          {
            ...pilotCase,
            consent: { ...consent, reportingScope: "private-only" },
            outcome,
            comparisonGate,
          },
        ],
        { requireOutcome: true, cohortDeclaration },
      ),
    ).toThrow(/comparison measurements/);
  });

  it("rejects the gate contract before touching malformed draft data", () => {
    expect(() =>
      runConsentedPilotHarness(
        [
          {
            ...pilotCase,
            consent: { ...consent, reportingScope: "private-only" },
            outcome,
            firstDraft: { ...pilotCase.firstDraft, sections: null as never },
          },
        ],
        { requireOutcome: true, cohortDeclaration },
      ),
    ).toThrow(/comparison gate/);
  });

  it("reports effort reduction as indeterminate when comparison measurements are missing", () => {
    const report = runConsentedPilotHarness([
      pilotCase,
      {
        ...pilotCase,
        id: "pilot-case-missing-effort",
        userEffort: {
          "first-draft": { reviewMinutes: 15, editCount: 6, approvalCount: 0 },
        },
      },
    ]);

    expect(report.variants["revised-draft"].averageReviewMinutes).toBe(8);
    expect(report.variants["manual-baseline"].averageReviewMinutes).toBe(25);
    expect(report.hypothesisValidation.effortReducedComparedToManual).toBe("indeterminate");
    expect(report.markdownReport).toContain("**Effort Reduced vs Manual:** INDETERMINATE");
    expect(report.markdownReport).not.toContain("candidate-sanitized-1");
  });

  it("reports the useful-finding ratio as indeterminate when no dispositions exist", () => {
    const report = runConsentedPilotHarness([
      {
        ...pilotCase,
        findingsDisposition: { usefulCount: 0, rejectedCount: 0 },
      },
    ]);

    expect(report.criticEfficiency.usefulFindingRatio).toBeNull();
    expect(report.markdownReport).toContain(
      "**Useful Finding Ratio:** INDETERMINATE (no findings dispositions recorded)",
    );
    expect(report.markdownReport).not.toContain("candidate-sanitized-1");
  });
});
