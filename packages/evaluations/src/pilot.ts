import { validateDraftArtifact } from "@draft-loop/validation";

import {
  compareEvaluationCase,
  type EvaluationCase,
  type EvaluationHarnessOptions,
  type EvaluationVariant,
  type ReadinessDimension,
  readinessDimensions,
} from "./index.js";
import {
  evaluatePilotComparisonGate,
  type PilotComparisonGate,
  type PilotComparisonGateDimension,
  type PilotComparisonGateEvaluationInput,
  type PilotComparisonGateStatus,
  type PilotComparisonMeasurements,
  pilotComparisonGateDimensions,
  validatePilotComparisonGate,
  validatePilotComparisonMeasurements,
} from "./pilot-comparison-gate.js";

export const pilotExportFormats = ["markdown", "docx", "pdf"] as const;
export type PilotExportFormat = (typeof pilotExportFormats)[number];

export const pilotObservationStates = ["not-tested", "not-observed", "observed"] as const;
export type PilotObservationState = (typeof pilotObservationStates)[number];

export const pilotLimitationCodes = [
  "single-consented-case",
  "manual-baseline-unavailable",
  "provider-cost-unavailable",
  "user-confidence-unavailable",
  "adversarial-observation-unavailable",
] as const;
export type PilotLimitationCode = (typeof pilotLimitationCodes)[number];

export type PilotReportingScope = "private-only" | "anonymized-public";

export interface PilotConsentRecord {
  readonly candidateId: string;
  readonly consentedAt: string;
  readonly sanitizationCompleted: boolean;
  readonly piiRedacted: boolean;
  readonly employerSecretsRedacted: boolean;
  readonly allowAnonymizedBenchmarking: boolean;
  /** Kept in the private consent record; it is never copied to the report. */
  readonly reportingScope?: PilotReportingScope;
}

/**
 * Content-free measures recorded after a user completes a real application.
 * Null means that the measure was explicitly unavailable, not zero.
 */
export interface PilotOutcomeRecord {
  readonly approvalCompleted: boolean;
  readonly exportCompleted: boolean;
  readonly exportFormats: readonly PilotExportFormat[];
  readonly rounds: number;
  readonly providerCostUsd: number | null;
  readonly userConfidence: number | null;
  readonly misleadingEvidence: PilotObservationState;
  readonly promptInjection: PilotObservationState;
  readonly limitations: readonly PilotLimitationCode[];
}

export interface ConsentedPilotCase extends EvaluationCase {
  readonly consent: PilotConsentRecord;
  readonly outcome?: PilotOutcomeRecord;
  /** Private, predeclared thresholds for a real-outcome comparison. */
  readonly comparisonGate?: PilotComparisonGate;
  /** Private measurements that are not available from deterministic checks. */
  readonly comparisonMeasurements?: PilotComparisonMeasurements;
  readonly findingsDisposition?: {
    readonly usefulCount: number;
    readonly rejectedCount: number;
  };
}

export interface PilotVariantSummary {
  readonly averageReadinessRate: number;
  readonly averageScores: Record<ReadinessDimension, number>;
  readonly averageReviewMinutes: number | null;
  readonly averageEditCount: number | null;
}

export type PilotHypothesisResult = "pass" | "fail" | "indeterminate";

export interface PilotVariantSafetyMeasures {
  readonly criticalRequirementCoverage: number | null;
  readonly unsupportedClaimCount: number | null;
}

export interface PilotComparisonGateSummary {
  readonly dimensions: Readonly<Record<PilotComparisonGateDimension, PilotComparisonGateStatus>>;
  readonly overall: PilotComparisonGateStatus;
}

export interface PilotSummaryReport {
  readonly generatedAt: string;
  readonly caseCount: number;
  readonly variants: Record<EvaluationVariant, PilotVariantSummary>;
  readonly criticEfficiency: {
    readonly totalUsefulFindings: number;
    readonly totalRejectedFindings: number;
    readonly usefulFindingRatio: number | null;
  };
  readonly hypothesisValidation: {
    readonly factualityPreservedOrImproved: PilotHypothesisResult;
    readonly effortReducedComparedToManual: PilotHypothesisResult;
    readonly recommendations: readonly string[];
  };
  readonly outcomeValidation: PilotHypothesisResult;
  /** Bounded statuses only; gate thresholds and per-case measurements stay private. */
  readonly comparisonGate: PilotComparisonGateSummary;
  readonly productMeasures: {
    readonly outcomeCaseCount: number;
    readonly approvalCompletionRate: number | null;
    readonly exportCompletionRate: number | null;
    readonly averageRounds: number | null;
    readonly totalProviderCostUsd: number | null;
    readonly averageUserConfidence: number | null;
    readonly variants: Record<EvaluationVariant, PilotVariantSafetyMeasures>;
    readonly misleadingEvidence: Record<PilotObservationState, number>;
    readonly promptInjection: Record<PilotObservationState, number>;
    readonly limitations: Record<PilotLimitationCode, number>;
  };
  readonly markdownReport: string;
}

export function validatePilotConsent(consent: PilotConsentRecord): void {
  if (
    !consent.sanitizationCompleted ||
    !consent.piiRedacted ||
    !consent.employerSecretsRedacted ||
    !consent.allowAnonymizedBenchmarking
  ) {
    throw new Error(
      `Pilot case for candidate ${consent.candidateId} lacks full consent and sanitization attestation.`,
    );
  }
}

export function validatePilotOutcome(outcome: PilotOutcomeRecord): void {
  if (!Number.isInteger(outcome.rounds) || outcome.rounds < 1) {
    throw new RangeError("Pilot outcome rounds must be a positive integer.");
  }
  if (
    outcome.providerCostUsd !== null &&
    (!Number.isFinite(outcome.providerCostUsd) || outcome.providerCostUsd < 0)
  ) {
    throw new RangeError("Pilot outcome provider cost must be null or a non-negative number.");
  }
  if (
    outcome.userConfidence !== null &&
    (!Number.isInteger(outcome.userConfidence) ||
      outcome.userConfidence < 1 ||
      outcome.userConfidence > 5)
  ) {
    throw new RangeError("Pilot outcome user confidence must be null or an integer from 1 to 5.");
  }
  if (outcome.exportCompleted && outcome.exportFormats.length === 0) {
    throw new Error("A completed pilot export must include at least one format.");
  }
  if (!outcome.exportCompleted && outcome.exportFormats.length > 0) {
    throw new Error("An incomplete pilot export cannot include exported formats.");
  }
  if (outcome.exportFormats.some((format) => !pilotExportFormats.includes(format))) {
    throw new Error("Pilot outcome export formats must be supported local formats.");
  }
  if (outcome.limitations.length === 0) {
    throw new Error("Pilot outcome limitations must be recorded explicitly.");
  }
  if (
    !pilotObservationStates.includes(outcome.misleadingEvidence) ||
    !pilotObservationStates.includes(outcome.promptInjection)
  ) {
    throw new Error("Pilot adversarial observations must use a supported observation state.");
  }
}

function validatePilotOutcomeCase(pilotCase: ConsentedPilotCase): void {
  validatePilotConsent(pilotCase.consent);
  if (pilotCase.consent.reportingScope === undefined) {
    throw new Error("A real pilot case must record its permitted reporting scope privately.");
  }
  if (pilotCase.outcome === undefined) {
    throw new Error("A real pilot case must record a content-free outcome measurement.");
  }
  validatePilotOutcome(pilotCase.outcome);
}

function validatePilotComparisonGateCase(pilotCase: ConsentedPilotCase): void {
  if (pilotCase.comparisonGate === undefined) {
    throw new Error("A real pilot case must record a predeclared comparison gate.");
  }
  if (pilotCase.comparisonMeasurements === undefined) {
    throw new Error("A real pilot case must record private comparison measurements.");
  }
  validatePilotComparisonGate(pilotCase.comparisonGate, {
    consentedAt: pilotCase.consent.consentedAt,
    firstDraftCreatedAt: pilotCase.firstDraft.createdAt,
  });
  validatePilotComparisonMeasurements(pilotCase.comparisonMeasurements);
}

function computeVariantSummary(
  variant: EvaluationVariant,
  comparisons: readonly ReturnType<typeof compareEvaluationCase>[],
): PilotVariantSummary {
  const n = Math.max(1, comparisons.length);
  let totalReady = 0;
  let totalReviewMinutes = 0;
  let reviewCount = 0;
  let totalEdits = 0;
  let editCount = 0;

  const scoreTotals: Record<ReadinessDimension, number> = Object.fromEntries(
    readinessDimensions.map((d) => [d, 0]),
  ) as Record<ReadinessDimension, number>;

  for (const comparison of comparisons) {
    const result = comparison.results.find((r) => r.variant === variant);
    if (!result) continue;
    if (result.evaluation.ready) {
      totalReady++;
    }
    for (const d of readinessDimensions) {
      scoreTotals[d] += result.evaluation.scoreVector[d];
    }
    if (result.userEffort?.reviewMinutes !== undefined) {
      totalReviewMinutes += result.userEffort.reviewMinutes;
      reviewCount++;
    }
    if (result.userEffort?.editCount !== undefined) {
      totalEdits += result.userEffort.editCount;
      editCount++;
    }
  }

  const averageScores: Record<ReadinessDimension, number> = Object.fromEntries(
    readinessDimensions.map((d) => [d, Number((scoreTotals[d] / n).toFixed(4))]),
  ) as Record<ReadinessDimension, number>;

  return {
    averageReadinessRate: Number((totalReady / n).toFixed(4)),
    averageScores,
    averageReviewMinutes:
      reviewCount > 0 ? Number((totalReviewMinutes / reviewCount).toFixed(1)) : null,
    averageEditCount: editCount > 0 ? Number((totalEdits / editCount).toFixed(1)) : null,
  };
}

function emptyObservationCounts(): Record<PilotObservationState, number> {
  return { "not-tested": 0, "not-observed": 0, observed: 0 };
}

function emptyLimitationCounts(): Record<PilotLimitationCode, number> {
  return Object.fromEntries(pilotLimitationCodes.map((code) => [code, 0])) as Record<
    PilotLimitationCode,
    number
  >;
}

function safetyMeasures(
  variant: EvaluationVariant,
  cases: readonly ConsentedPilotCase[],
): PilotVariantSafetyMeasures {
  let criticalRequirements = 0;
  let coveredCriticalRequirements = 0;
  let unsupportedClaims = 0;

  for (const pilotCase of cases) {
    const validation = validateDraftVariant(variant, pilotCase);
    const uncovered = new Set(
      validation.issues
        .filter((issue) => issue.code === "uncovered-requirement")
        .map((issue) => issue.requirementId),
    );
    const critical = pilotCase.context.requirements.filter(
      (requirement) => requirement.priority === "critical",
    );
    criticalRequirements += critical.length;
    coveredCriticalRequirements += critical.filter(
      (requirement) => !uncovered.has(requirement.id),
    ).length;
    unsupportedClaims += validation.issues.filter(
      (issue) => issue.code === "unsupported-claim",
    ).length;
  }

  return {
    criticalRequirementCoverage:
      criticalRequirements === 0
        ? null
        : Number((coveredCriticalRequirements / criticalRequirements).toFixed(4)),
    unsupportedClaimCount: unsupportedClaims,
  };
}

function validateDraftVariant(
  variant: EvaluationVariant,
  pilotCase: ConsentedPilotCase,
): ReturnType<typeof validateDraftArtifact> {
  const artifact =
    variant === "first-draft"
      ? pilotCase.firstDraft
      : variant === "revised-draft"
        ? pilotCase.revisedDraft
        : pilotCase.manualBaseline;
  return validateDraftArtifact(artifact, pilotCase.context);
}

function caseSafetyMeasures(
  variant: EvaluationVariant,
  pilotCase: ConsentedPilotCase,
): PilotVariantSafetyMeasures {
  const validation = validateDraftVariant(variant, pilotCase);
  const uncovered = new Set(
    validation.issues
      .filter((issue) => issue.code === "uncovered-requirement")
      .map((issue) => issue.requirementId),
  );
  const critical = pilotCase.context.requirements.filter(
    (requirement) => requirement.priority === "critical",
  );
  return {
    criticalRequirementCoverage:
      critical.length === 0
        ? null
        : Number(
            (
              critical.filter((requirement) => !uncovered.has(requirement.id)).length /
              critical.length
            ).toFixed(4),
          ),
    unsupportedClaimCount: validation.issues.filter((issue) => issue.code === "unsupported-claim")
      .length,
  };
}

function averageNullable(values: readonly (number | null)[]): number | null {
  const available = values.filter((value): value is number => value !== null);
  return available.length === 0
    ? null
    : Number((available.reduce((total, value) => total + value, 0) / available.length).toFixed(2));
}

function emptyComparisonGateSummary(): PilotComparisonGateSummary {
  return {
    dimensions: Object.fromEntries(
      pilotComparisonGateDimensions.map((dimension) => [dimension, "indeterminate"]),
    ) as Record<PilotComparisonGateDimension, PilotComparisonGateStatus>,
    overall: "indeterminate",
  };
}

function aggregatePilotComparisonGateStatuses(
  evaluations: readonly ReturnType<typeof evaluatePilotComparisonGate>[],
): PilotComparisonGateSummary {
  const dimensions = Object.fromEntries(
    pilotComparisonGateDimensions.map((dimension) => {
      const statuses = evaluations.map((evaluation) => evaluation.dimensions[dimension]);
      const status: PilotComparisonGateStatus = statuses.includes("fail")
        ? "fail"
        : statuses.includes("indeterminate")
          ? "indeterminate"
          : "pass";
      return [dimension, status];
    }),
  ) as Record<PilotComparisonGateDimension, PilotComparisonGateStatus>;
  const statuses = Object.values(dimensions);
  return {
    dimensions,
    overall: statuses.includes("fail")
      ? "fail"
      : statuses.includes("indeterminate")
        ? "indeterminate"
        : "pass",
  };
}

function evaluateComparisonGateSummary(
  cases: readonly ConsentedPilotCase[],
  comparisons: readonly ReturnType<typeof compareEvaluationCase>[],
): PilotComparisonGateSummary {
  const evaluations = cases.map((pilotCase, index) => {
    const gate = pilotCase.comparisonGate;
    const measurements = pilotCase.comparisonMeasurements;
    const comparison = comparisons[index];
    if (gate === undefined || measurements === undefined || comparison === undefined) {
      throw new Error("Pilot comparison gate data is incomplete.");
    }
    const revised = comparison.results.find((result) => result.variant === "revised-draft");
    if (revised === undefined) {
      throw new Error("Pilot comparison results are incomplete.");
    }
    const revisedSafety = caseSafetyMeasures("revised-draft", pilotCase);
    const input: PilotComparisonGateEvaluationInput = {
      ...measurements,
      unsupportedClaimCount: revisedSafety.unsupportedClaimCount,
      criticalRequirementCoverage: revisedSafety.criticalRequirementCoverage,
      revisedReviewMinutes: pilotCase.userEffort?.["revised-draft"]?.reviewMinutes ?? null,
      revisedEditCount: pilotCase.userEffort?.["revised-draft"]?.editCount ?? null,
      revisedReady: revised.evaluation.ready,
      approvalCompleted: pilotCase.outcome?.approvalCompleted ?? null,
      exportCompleted: pilotCase.outcome?.exportCompleted ?? null,
    };
    return evaluatePilotComparisonGate(gate, input);
  });
  return aggregatePilotComparisonGateStatuses(evaluations);
}

export function generatePilotMarkdownReport(
  report: Omit<PilotSummaryReport, "markdownReport">,
): string {
  const lines: string[] = [];
  lines.push("# Real-Application Consented Pilot Summary Report");
  lines.push("");
  lines.push(`- **Generated At:** ${report.generatedAt}`);
  lines.push(`- **Consented Cases:** ${report.caseCount}`);
  lines.push(
    "- **Sanitization & Redaction:** Attested in consent records for all included cases; not independently verified by this harness",
  );
  lines.push("");
  lines.push("## Tri-Variant Quality & Effort Comparison");
  lines.push("");
  lines.push(
    "| Metric / Dimension | First Draft (Single-Pass) | Revised Draft (Author-Critic) | Manual Baseline (Human Reference) |",
  );
  lines.push("| :--- | :--- | :--- | :--- |");
  lines.push(
    `| **Readiness Rate** | ${(report.variants["first-draft"].averageReadinessRate * 100).toFixed(1)}% | ${(report.variants["revised-draft"].averageReadinessRate * 100).toFixed(1)}% | ${(report.variants["manual-baseline"].averageReadinessRate * 100).toFixed(1)}% |`,
  );

  for (const d of readinessDimensions) {
    const capitalized = d.charAt(0).toUpperCase() + d.slice(1);
    lines.push(
      `| ${capitalized} Score | ${report.variants["first-draft"].averageScores[d].toFixed(3)} | ${report.variants["revised-draft"].averageScores[d].toFixed(3)} | ${report.variants["manual-baseline"].averageScores[d].toFixed(3)} |`,
    );
  }

  lines.push(
    `| Average Review Minutes | ${report.variants["first-draft"].averageReviewMinutes ?? "N/A"} min | ${report.variants["revised-draft"].averageReviewMinutes ?? "N/A"} min | ${report.variants["manual-baseline"].averageReviewMinutes ?? "N/A"} min |`,
  );
  lines.push(
    `| Average Edit Count | ${report.variants["first-draft"].averageEditCount ?? "N/A"} | ${report.variants["revised-draft"].averageEditCount ?? "N/A"} | ${report.variants["manual-baseline"].averageEditCount ?? "N/A"} |`,
  );

  lines.push("");
  lines.push("## Critic Efficiency");
  lines.push("");
  lines.push(`- **Useful Findings:** ${report.criticEfficiency.totalUsefulFindings}`);
  lines.push(`- **Rejected Findings:** ${report.criticEfficiency.totalRejectedFindings}`);
  lines.push(
    `- **Useful Finding Ratio:** ${report.criticEfficiency.usefulFindingRatio === null ? "INDETERMINATE (no findings dispositions recorded)" : `${(report.criticEfficiency.usefulFindingRatio * 100).toFixed(1)}%`}`,
  );

  lines.push("");
  lines.push("## Hypothesis Validation");
  lines.push("");
  lines.push(
    `- **Factuality Preserved / Improved:** ${report.hypothesisValidation.factualityPreservedOrImproved.toUpperCase()}`,
  );
  lines.push(
    `- **Effort Reduced vs Manual:** ${report.hypothesisValidation.effortReducedComparedToManual.toUpperCase()}`,
  );

  if (report.hypothesisValidation.recommendations.length > 0) {
    lines.push("");
    lines.push("### Recommendations");
    for (const rec of report.hypothesisValidation.recommendations) {
      lines.push(`- ${rec}`);
    }
  }

  lines.push("");
  lines.push("## Predeclared comparison gate");
  lines.push("");
  lines.push(`- **Overall:** ${report.comparisonGate.overall.toUpperCase()}`);
  const comparisonGateLabels: Readonly<Record<PilotComparisonGateDimension, string>> = {
    factualSafety: "Factual safety",
    requiredSectionPreservation: "Required-section preservation",
    chronologyPreservation: "Chronology preservation",
    relevantAchievementRecall: "Relevant-achievement recall",
    criticalRequirementCoverage: "Critical-requirement coverage",
    boundedHumanReview: "Bounded human review",
    professionalReadiness: "Professional readiness",
  };
  for (const dimension of pilotComparisonGateDimensions) {
    lines.push(
      `- **${comparisonGateLabels[dimension]}:** ${report.comparisonGate.dimensions[dimension].toUpperCase()}`,
    );
  }

  lines.push("");
  lines.push("## Consented application outcome");
  lines.push("");
  lines.push(`- **Outcome validation:** ${report.outcomeValidation.toUpperCase()}`);
  if (report.productMeasures.outcomeCaseCount === 0) {
    lines.push(
      "- **Evidence status:** INDETERMINATE — no consented application outcome was supplied; synthetic or fixture results are not real-application evidence.",
    );
  } else {
    lines.push(
      `- **Approval completion:** ${((report.productMeasures.approvalCompletionRate ?? 0) * 100).toFixed(1)}% of recorded outcome cases`,
    );
    lines.push(
      `- **Export completion:** ${((report.productMeasures.exportCompletionRate ?? 0) * 100).toFixed(1)}% of recorded outcome cases`,
    );
    lines.push(`- **Average rounds:** ${report.productMeasures.averageRounds ?? "N/A"}`);
    lines.push(
      `- **Total provider cost (USD):** ${report.productMeasures.totalProviderCostUsd ?? "N/A"}`,
    );
    lines.push(
      `- **Average user confidence (1–5):** ${report.productMeasures.averageUserConfidence ?? "N/A"}`,
    );
  }
  lines.push(
    `- **Critical-requirement coverage (first / revised / manual):** ${report.productMeasures.variants["first-draft"].criticalRequirementCoverage ?? "N/A"} / ${report.productMeasures.variants["revised-draft"].criticalRequirementCoverage ?? "N/A"} / ${report.productMeasures.variants["manual-baseline"].criticalRequirementCoverage ?? "N/A"}`,
  );
  lines.push(
    `- **Unsupported-claim counts (first / revised / manual):** ${report.productMeasures.variants["first-draft"].unsupportedClaimCount ?? "N/A"} / ${report.productMeasures.variants["revised-draft"].unsupportedClaimCount ?? "N/A"} / ${report.productMeasures.variants["manual-baseline"].unsupportedClaimCount ?? "N/A"}`,
  );
  lines.push(
    `- **Misleading-evidence observation:** ${report.productMeasures.misleadingEvidence.observed > 0 ? "OBSERVED" : report.productMeasures.misleadingEvidence["not-tested"] > 0 ? "NOT TESTED" : "NOT OBSERVED"}`,
  );
  lines.push(
    `- **Prompt-injection observation:** ${report.productMeasures.promptInjection.observed > 0 ? "OBSERVED" : report.productMeasures.promptInjection["not-tested"] > 0 ? "NOT TESTED" : "NOT OBSERVED"}`,
  );
  const recordedLimitations = Object.entries(report.productMeasures.limitations)
    .filter(([, count]) => count > 0)
    .map(([code, count]) => `${code} (${count})`);
  lines.push(
    `- **Recorded limitations:** ${recordedLimitations.length > 0 ? recordedLimitations.join(", ") : "none recorded"}`,
  );
  lines.push(
    "- **Limitation:** This report is a sanitized measurement summary, not proof that the product generalizes beyond the recorded sample.",
  );

  return lines.join("\n");
}

export interface PilotHarnessOptions extends EvaluationHarnessOptions {
  /** Require private scope and outcome measures for every supplied case. */
  readonly requireOutcome?: boolean;
}

export function runConsentedPilotHarness(
  cases: readonly ConsentedPilotCase[],
  options?: PilotHarnessOptions,
): PilotSummaryReport {
  if (cases.length === 0) {
    throw new Error("A consented pilot requires at least one case.");
  }

  for (const pilotCase of cases) {
    if (options?.requireOutcome) {
      validatePilotOutcomeCase(pilotCase);
      // All private gate declarations and measurements are checked before any
      // draft evaluation runs, so malformed real-outcome input cannot reach
      // compareEvaluationCase.
      validatePilotComparisonGateCase(pilotCase);
    } else {
      validatePilotConsent(pilotCase.consent);
    }
  }

  const comparisons = cases.map((pilotCase) => compareEvaluationCase(pilotCase, options));
  const comparisonGate = options?.requireOutcome
    ? evaluateComparisonGateSummary(cases, comparisons)
    : emptyComparisonGateSummary();

  const variants: Record<EvaluationVariant, PilotVariantSummary> = {
    "first-draft": computeVariantSummary("first-draft", comparisons),
    "revised-draft": computeVariantSummary("revised-draft", comparisons),
    "manual-baseline": computeVariantSummary("manual-baseline", comparisons),
  };

  let totalUseful = 0;
  let totalRejected = 0;
  for (const c of cases) {
    if (c.findingsDisposition) {
      totalUseful += c.findingsDisposition.usefulCount;
      totalRejected += c.findingsDisposition.rejectedCount;
    }
  }
  const totalFindings = totalUseful + totalRejected;
  const usefulFindingRatio = totalFindings > 0 ? totalUseful / totalFindings : null;

  const firstAccuracy = variants["first-draft"].averageScores.accuracy;
  const revisedAccuracy = variants["revised-draft"].averageScores.accuracy;
  const firstEvidence = variants["first-draft"].averageScores.evidence;
  const revisedEvidence = variants["revised-draft"].averageScores.evidence;

  const factualityPreservedOrImproved: PilotHypothesisResult =
    revisedAccuracy >= firstAccuracy - 0.05 && revisedEvidence >= firstEvidence - 0.05
      ? "pass"
      : "fail";

  const manualMinutes = variants["manual-baseline"].averageReviewMinutes;
  const revisedMinutes = variants["revised-draft"].averageReviewMinutes;
  const effortMeasurementsComplete = cases.every(
    (pilotCase) =>
      pilotCase.userEffort?.["revised-draft"]?.reviewMinutes !== undefined &&
      pilotCase.userEffort["manual-baseline"]?.reviewMinutes !== undefined,
  );
  const effortReducedComparedToManual: PilotHypothesisResult =
    !effortMeasurementsComplete || manualMinutes === null || revisedMinutes === null
      ? "indeterminate"
      : revisedMinutes < manualMinutes
        ? "pass"
        : "fail";

  const recommendations: string[] = [];
  if (factualityPreservedOrImproved === "fail") {
    recommendations.push("Critic feedback must tighten evidence verification checks.");
  }
  if (effortReducedComparedToManual === "fail") {
    recommendations.push("Simplify review diffs to accelerate candidate validation.");
  }
  if (usefulFindingRatio !== null && usefulFindingRatio < 0.7) {
    recommendations.push(
      "Calibrate critic sensitivity to decrease rejected false-positive findings.",
    );
  }

  const outcomes = cases.flatMap((pilotCase) =>
    pilotCase.outcome === undefined ? [] : [pilotCase.outcome],
  );
  const outcomeCaseCount = outcomes.length;
  const allOutcomesComplete =
    outcomeCaseCount === cases.length &&
    outcomes.every((outcome) => outcome.approvalCompleted && outcome.exportCompleted);
  const outcomeValidation: PilotHypothesisResult =
    outcomeCaseCount === 0
      ? "indeterminate"
      : !allOutcomesComplete || factualityPreservedOrImproved !== "pass"
        ? "fail"
        : options?.requireOutcome && comparisonGate.overall === "indeterminate"
          ? "indeterminate"
          : !options?.requireOutcome || comparisonGate.overall === "pass"
            ? "pass"
            : "fail";
  const misleadingEvidence = emptyObservationCounts();
  const promptInjection = emptyObservationCounts();
  const limitations = emptyLimitationCounts();
  for (const outcome of outcomes) {
    misleadingEvidence[outcome.misleadingEvidence]++;
    promptInjection[outcome.promptInjection]++;
    for (const limitation of outcome.limitations) {
      limitations[limitation]++;
    }
  }
  const totalProviderCostUsd =
    outcomes.length > 0 && outcomes.every((outcome) => outcome.providerCostUsd !== null)
      ? Number(
          outcomes.reduce((total, outcome) => total + (outcome.providerCostUsd ?? 0), 0).toFixed(4),
        )
      : null;
  const productMeasures = {
    outcomeCaseCount,
    approvalCompletionRate:
      outcomeCaseCount === 0
        ? null
        : Number(
            (
              outcomes.filter((outcome) => outcome.approvalCompleted).length / outcomeCaseCount
            ).toFixed(4),
          ),
    exportCompletionRate:
      outcomeCaseCount === 0
        ? null
        : Number(
            (
              outcomes.filter((outcome) => outcome.exportCompleted).length / outcomeCaseCount
            ).toFixed(4),
          ),
    averageRounds: averageNullable(outcomes.map((outcome) => outcome.rounds)),
    totalProviderCostUsd,
    averageUserConfidence: averageNullable(outcomes.map((outcome) => outcome.userConfidence)),
    variants: {
      "first-draft": safetyMeasures("first-draft", cases),
      "revised-draft": safetyMeasures("revised-draft", cases),
      "manual-baseline": safetyMeasures("manual-baseline", cases),
    },
    misleadingEvidence,
    promptInjection,
    limitations,
  } satisfies PilotSummaryReport["productMeasures"];

  const baseReport = {
    generatedAt: new Date().toISOString(),
    caseCount: cases.length,
    variants,
    criticEfficiency: {
      totalUsefulFindings: totalUseful,
      totalRejectedFindings: totalRejected,
      usefulFindingRatio:
        usefulFindingRatio === null ? null : Number(usefulFindingRatio.toFixed(4)),
    },
    hypothesisValidation: {
      factualityPreservedOrImproved,
      effortReducedComparedToManual,
      recommendations,
    },
    outcomeValidation,
    comparisonGate,
    productMeasures,
  };

  return {
    ...baseReport,
    markdownReport: generatePilotMarkdownReport(baseReport),
  };
}
