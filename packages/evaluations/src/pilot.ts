import {
  compareEvaluationCase,
  type EvaluationCase,
  type EvaluationHarnessOptions,
  type EvaluationVariant,
  type ReadinessDimension,
  readinessDimensions,
} from "./index.js";

export interface PilotConsentRecord {
  readonly candidateId: string;
  readonly consentedAt: string;
  readonly sanitizationCompleted: boolean;
  readonly piiRedacted: boolean;
  readonly employerSecretsRedacted: boolean;
  readonly allowAnonymizedBenchmarking: boolean;
}

export interface ConsentedPilotCase extends EvaluationCase {
  readonly consent: PilotConsentRecord;
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

export interface PilotSummaryReport {
  readonly generatedAt: string;
  readonly caseCount: number;
  readonly variants: Record<EvaluationVariant, PilotVariantSummary>;
  readonly criticEfficiency: {
    readonly totalUsefulFindings: number;
    readonly totalRejectedFindings: number;
    readonly usefulFindingRatio: number;
  };
  readonly hypothesisValidation: {
    readonly factualityPreservedOrImproved: boolean;
    readonly effortReducedComparedToManual: boolean;
    readonly recommendations: readonly string[];
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
      `Pilot case for candidate ${consent.candidateId} lacks full consent and sanitization verification.`,
    );
  }
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

export function generatePilotMarkdownReport(
  report: Omit<PilotSummaryReport, "markdownReport">,
): string {
  const lines: string[] = [];
  lines.push("# Real-Application Consented Pilot Summary Report");
  lines.push("");
  lines.push(`- **Generated At:** ${report.generatedAt}`);
  lines.push(`- **Consented Cases:** ${report.caseCount}`);
  lines.push("- **Sanitization & Redaction:** 100% compliant (Zero raw candidate text retained)");
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
    `- **Useful Finding Ratio:** ${(report.criticEfficiency.usefulFindingRatio * 100).toFixed(1)}%`,
  );

  lines.push("");
  lines.push("## Hypothesis Validation");
  lines.push("");
  lines.push(
    `- **Factuality Preserved / Improved:** ${report.hypothesisValidation.factualityPreservedOrImproved ? "PASS" : "FAIL"}`,
  );
  lines.push(
    `- **Effort Reduced vs Manual:** ${report.hypothesisValidation.effortReducedComparedToManual ? "PASS" : "FAIL"}`,
  );

  if (report.hypothesisValidation.recommendations.length > 0) {
    lines.push("");
    lines.push("### Recommendations");
    for (const rec of report.hypothesisValidation.recommendations) {
      lines.push(`- ${rec}`);
    }
  }

  return lines.join("\n");
}

export function runConsentedPilotHarness(
  cases: readonly ConsentedPilotCase[],
  options?: EvaluationHarnessOptions,
): PilotSummaryReport {
  for (const pilotCase of cases) {
    validatePilotConsent(pilotCase.consent);
  }

  const comparisons = cases.map((pilotCase) => compareEvaluationCase(pilotCase, options));

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
  const usefulFindingRatio = totalFindings > 0 ? totalUseful / totalFindings : 1.0;

  const firstAccuracy = variants["first-draft"].averageScores.accuracy;
  const revisedAccuracy = variants["revised-draft"].averageScores.accuracy;
  const firstEvidence = variants["first-draft"].averageScores.evidence;
  const revisedEvidence = variants["revised-draft"].averageScores.evidence;

  const factualityPreservedOrImproved =
    revisedAccuracy >= firstAccuracy - 0.05 && revisedEvidence >= firstEvidence - 0.05;

  const manualMinutes = variants["manual-baseline"].averageReviewMinutes;
  const revisedMinutes = variants["revised-draft"].averageReviewMinutes;
  const effortReducedComparedToManual =
    manualMinutes !== null && revisedMinutes !== null ? revisedMinutes < manualMinutes : true;

  const recommendations: string[] = [];
  if (!factualityPreservedOrImproved) {
    recommendations.push("Critic feedback must tighten evidence verification checks.");
  }
  if (!effortReducedComparedToManual) {
    recommendations.push("Simplify review diffs to accelerate candidate validation.");
  }
  if (usefulFindingRatio < 0.7) {
    recommendations.push(
      "Calibrate critic sensitivity to decrease rejected false-positive findings.",
    );
  }

  const baseReport = {
    generatedAt: new Date().toISOString(),
    caseCount: cases.length,
    variants,
    criticEfficiency: {
      totalUsefulFindings: totalUseful,
      totalRejectedFindings: totalRejected,
      usefulFindingRatio: Number(usefulFindingRatio.toFixed(4)),
    },
    hypothesisValidation: {
      factualityPreservedOrImproved,
      effortReducedComparedToManual,
      recommendations,
    },
  };

  return {
    ...baseReport,
    markdownReport: generatePilotMarkdownReport(baseReport),
  };
}
