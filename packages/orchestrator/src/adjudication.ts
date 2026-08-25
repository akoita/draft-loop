import type { BuiltIndependentReadinessReport } from "@draft-loop/evaluations";
import {
  type AuthorAdjudicationDecisionInput,
  type AuthorAdjudicationPlan,
  authorAdjudicationDecisionInputSchema,
  authorAdjudicationPlanSchema,
  authorAdjudicationPlanSchemaVersion,
  type DraftArtifact,
  draftArtifactSchema,
  type IndependentReadinessReport,
  independentReadinessReportSchema,
} from "@draft-loop/schemas";

type ReadinessReportInput = IndependentReadinessReport | BuiltIndependentReadinessReport;

export interface BuildAuthorAdjudicationPlanInput {
  readonly report: ReadinessReportInput;
  readonly sourceArtifact: DraftArtifact;
  readonly createdAt: string;
  readonly decisions: readonly AuthorAdjudicationDecisionInput[];
}

function validateFindingTarget(
  finding: IndependentReadinessReport["findings"][number],
  sourceArtifact: DraftArtifact,
): void {
  switch (finding.target.kind) {
    case "artifact":
      if (finding.target.id !== sourceArtifact.id) {
        throw new Error(
          `Finding ${finding.id} targets artifact ${finding.target.id}, not source artifact ${sourceArtifact.id}.`,
        );
      }
      return;
    case "claim":
      if (!sourceArtifact.claims.some((claim) => claim.id === finding.target.id)) {
        throw new Error(`Finding ${finding.id} targets missing claim ${finding.target.id}.`);
      }
      return;
    case "section":
      if (!sourceArtifact.sections.some((section) => section.id === finding.target.id)) {
        throw new Error(`Finding ${finding.id} targets missing section ${finding.target.id}.`);
      }
      return;
    case "evidence":
    case "requirement":
    case "rubric":
      // These targets belong to the report/context boundary and cannot be
      // resolved against the artifact alone in this contract slice.
      return;
  }
}

/**
 * Build a strict, immutable author adjudication plan for exactly one report
 * and its source artifact. This function does not choose a decision or infer
 * a rationale on the author's behalf.
 */
export function buildAuthorAdjudicationPlan(
  input: BuildAuthorAdjudicationPlanInput,
): AuthorAdjudicationPlan {
  const report = independentReadinessReportSchema.parse(input.report);
  const parsedSourceArtifact = draftArtifactSchema.parse(input.sourceArtifact);

  if (
    report.artifact.id !== parsedSourceArtifact.id ||
    report.artifact.version !== parsedSourceArtifact.version
  ) {
    throw new Error("The readiness report artifact must match the source artifact identity.");
  }

  for (const finding of report.findings) {
    validateFindingTarget(finding, parsedSourceArtifact);
  }

  const parsedDecisions = input.decisions.map((decision, index) => {
    const parsed = authorAdjudicationDecisionInputSchema.safeParse(decision);
    if (!parsed.success) {
      throw new Error(`Adjudication decision ${index + 1} is invalid.`);
    }
    return parsed.data;
  });
  const findingsById = new Map(report.findings.map((finding) => [finding.id, finding]));
  const seenDecisionIds = new Set<string>();
  for (const decision of parsedDecisions) {
    if (seenDecisionIds.has(decision.findingId)) {
      throw new Error(`Adjudication decision ${decision.findingId} is duplicated.`);
    }
    seenDecisionIds.add(decision.findingId);
    if (!findingsById.has(decision.findingId)) {
      throw new Error(
        `Adjudication decision ${decision.findingId} is not in the readiness report.`,
      );
    }
  }
  if (parsedDecisions.length !== report.findings.length) {
    throw new Error("Exactly one adjudication decision is required for every report finding.");
  }

  const decisionsById = new Map(parsedDecisions.map((decision) => [decision.findingId, decision]));
  const canonicalDecisions = report.findings.map((finding) => {
    const decision = decisionsById.get(finding.id);
    if (decision === undefined) {
      throw new Error(`Adjudication decision ${finding.id} is missing.`);
    }
    return {
      findingId: finding.id,
      origin: finding.origin,
      code: finding.code,
      severity: finding.severity,
      target: { ...finding.target },
      recommendedAction: finding.recommendedAction,
      rationale: decision.rationale,
      disposition: decision.disposition,
      effectRequirement:
        decision.disposition === "accept" ? "revision-required" : "disagreement-preserved",
    } as const;
  });

  const plan = authorAdjudicationPlanSchema.parse({
    schemaVersion: authorAdjudicationPlanSchemaVersion,
    contextSnapshotId: report.contextSnapshotId,
    sourceReport: {
      schemaVersion: report.schemaVersion,
      createdAt: report.createdAt,
      artifact: { ...report.artifact },
    },
    sourceArtifact: {
      id: parsedSourceArtifact.id,
      version: parsedSourceArtifact.version,
    },
    createdAt: input.createdAt,
    decisions: canonicalDecisions,
  });

  return deepFreeze(plan);
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return value;
}
