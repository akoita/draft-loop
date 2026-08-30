import { createHash } from "node:crypto";

import { stableSerializeArtifact } from "@draft-loop/artifacts";
import {
  type ContextSnapshot,
  describeIndependentReview,
  type ReadinessDimension,
} from "@draft-loop/domain";
import {
  buildIndependentReadinessReport,
  evaluateApplicationReadinessStoppingDecision,
  evaluateReadiness,
  type ReadinessEvaluation,
  type ReadinessFinding,
  readinessDimensions,
} from "@draft-loop/evaluations";
import {
  type AdjudicatedRevisionTrace,
  type ApplicationReadinessStoppingDecision,
  applicationReadinessStoppingDecisionSchema,
  type DraftArtifact,
  type IndependentReadinessReport,
  type IndependentReadinessReportFindingInput,
  independentReadinessReportSchema,
  type ReadinessDimensionAgreement,
} from "@draft-loop/schemas";
import {
  type DeterministicValidationContext,
  type ValidationIssue,
  validateDraftArtifact,
} from "@draft-loop/validation";
import type { CritiqueFinding, RunBudget } from "./index.js";

/** The durable identity/content binding recorded when a human approves. */
export interface ApprovedArtifactBinding {
  readonly id: string;
  readonly version: number;
  readonly checksum: string;
}

export interface BuildApplicationReadinessDecisionInput {
  readonly artifact: DraftArtifact;
  readonly context: ContextSnapshot;
  readonly critiqueFindings: readonly CritiqueFinding[];
  readonly round: number;
  readonly budget: RunBudget;
  readonly priorScoreHistory: ReadonlyArray<ReadinessEvaluation["scoreVector"]>;
  readonly latestRevisionTrace?: AdjudicatedRevisionTrace;
  readonly explicitGapRequirementIds?: readonly string[];
  readonly createdAt: string;
}

function deterministicContext(context: ContextSnapshot): DeterministicValidationContext {
  return {
    requirements: [...context.requirements],
    outputConstraints: {
      ...context.outputConstraints,
      requiredSections: [...context.outputConstraints.requiredSections],
    },
    ...(context.writingPolicy === undefined ? {} : { writingPolicy: context.writingPolicy }),
  };
}

function findingTarget(
  artifact: DraftArtifact,
  finding: Pick<ValidationIssue, "claimId" | "sectionId" | "requirementId">,
): IndependentReadinessReportFindingInput["target"] {
  if (finding.claimId !== undefined) return { kind: "claim", id: finding.claimId };
  if (finding.sectionId !== undefined) return { kind: "section", id: finding.sectionId };
  if (finding.requirementId !== undefined) {
    return { kind: "requirement", id: finding.requirementId };
  }
  return { kind: "artifact", id: artifact.id };
}

function reportFindingFromValidation(
  artifact: DraftArtifact,
  issue: ValidationIssue,
  index: number,
): IndependentReadinessReportFindingInput {
  return {
    id: `deterministic:${index}:${issue.code}`,
    code: issue.code,
    category: issue.category ?? "quality",
    severity: issue.severity,
    rationale: issue.message,
    target: findingTarget(artifact, issue),
    recommendedAction: "Resolve this deterministic check before approval.",
    confidence: 1,
  };
}

function reportFindingFromCritique(
  artifact: DraftArtifact,
  finding: CritiqueFinding,
  index: number,
): IndependentReadinessReportFindingInput {
  return {
    id: `critic:${index}:${finding.id}`,
    code: finding.code,
    category: finding.category,
    severity: finding.severity,
    rationale: finding.message,
    target: findingTarget(artifact, finding),
    recommendedAction: "Review this independent finding before approval.",
    // CritiqueFinding predates a confidence field; do not imply a stronger
    // confidence than the runtime actually recorded.
    confidence: 0.5,
  };
}

function asReadinessFinding(issue: ValidationIssue): ReadinessFinding {
  return {
    code: issue.code,
    severity: issue.severity,
    message: issue.message,
    ...(issue.category === undefined ? {} : { category: issue.category }),
    ...(issue.claimId === undefined ? {} : { claimId: issue.claimId }),
    ...(issue.sectionId === undefined ? {} : { sectionId: issue.sectionId }),
    ...(issue.requirementId === undefined ? {} : { requirementId: issue.requirementId }),
  };
}

function asReadinessFindingFromCritique(finding: CritiqueFinding): ReadinessFinding {
  return {
    code: finding.code,
    severity: finding.severity,
    message: finding.message,
    ...(finding.category === undefined ? {} : { category: finding.category }),
    ...(finding.claimId === undefined ? {} : { claimId: finding.claimId }),
    ...(finding.sectionId === undefined ? {} : { sectionId: finding.sectionId }),
    ...(finding.requirementId === undefined ? {} : { requirementId: finding.requirementId }),
  };
}

function dimensionForCategory(category: string): ReadinessDimension | undefined {
  switch (category) {
    case "format":
      return "format";
    case "factuality":
      return "accuracy";
    case "coverage":
      return "relevance";
    case "evidence":
      return "evidence";
    case "quality":
      return "clarity";
    default:
      return undefined;
  }
}

function dimensionsForReportFinding(
  finding: IndependentReadinessReport["findings"][number],
): readonly ReadinessDimension[] {
  if (finding.target.kind === "rubric") return [finding.target.id];
  const dimension = dimensionForCategory(finding.category);
  return dimension === undefined ? [] : [dimension];
}

function dimensionsForAdjudicationTarget(
  target: AdjudicatedRevisionTrace["adjudication"]["decisions"][number]["target"],
): readonly ReadinessDimension[] {
  switch (target.kind) {
    case "rubric":
      return [target.id];
    case "requirement":
      return ["relevance"];
    case "claim":
      return ["accuracy", "evidence"];
    case "section":
      return ["clarity", "format"];
    case "artifact":
      return [...readinessDimensions];
    case "evidence":
      return ["evidence"];
  }
}

function projectAgreements(
  report: IndependentReadinessReport,
  trace: AdjudicatedRevisionTrace | undefined,
): readonly ReadinessDimensionAgreement[] {
  const disputed = new Set<ReadinessDimension>();

  // Runtime has no per-dimension author score. The smallest honest projection
  // is agreement only where the independent review recorded no error for that
  // dimension; warnings remain visible as report limitations. This avoids
  // inventing agreement while retaining a usable, deterministic happy path.
  for (const finding of report.findings) {
    if (finding.origin === "critic" && finding.severity === "error") {
      for (const dimension of dimensionsForReportFinding(finding)) disputed.add(dimension);
    }
  }

  for (const effect of trace?.effects ?? []) {
    if (effect.status !== "disagreement-preserved") continue;
    const decision = trace?.adjudication.decisions.find(
      (candidate) => candidate.findingId === effect.findingId,
    );
    if (decision !== undefined) {
      for (const dimension of dimensionsForAdjudicationTarget(decision.target)) {
        disputed.add(dimension);
      }
    }
  }

  return readinessDimensions.map((dimension) =>
    disputed.has(dimension)
      ? {
          dimension,
          status: "disputed" as const,
          rationale: `An unresolved independent-review disagreement remains for ${dimension}.`,
        }
      : {
          dimension,
          status: "agreed" as const,
          rationale: `No independent-review disagreement was recorded for ${dimension}; this is a conservative runtime projection, not an additional agent claim.`,
        },
  );
}

function readinessEvaluation(
  artifact: DraftArtifact,
  context: ContextSnapshot,
  deterministicFindings: readonly ValidationIssue[],
  critiqueFindings: readonly CritiqueFinding[],
  input: BuildApplicationReadinessDecisionInput,
): ReadinessEvaluation {
  return evaluateReadiness(
    artifact,
    {
      requirements: [...context.requirements],
      outputConstraints: {
        ...context.outputConstraints,
        requiredSections: [...context.outputConstraints.requiredSections],
      },
      readinessRubric: context.readinessRubric,
    },
    {
      round: input.round,
      priorScoreHistory: input.priorScoreHistory,
      maxRounds: input.budget.maxRounds,
      findings: [
        ...deterministicFindings.map(asReadinessFinding),
        ...critiqueFindings.map(asReadinessFindingFromCritique),
      ],
    },
  );
}

/** Assemble and evaluate the exact current artifact at the approval boundary. */
export function buildApplicationReadinessStoppingDecision(
  input: BuildApplicationReadinessDecisionInput,
): ApplicationReadinessStoppingDecision {
  const validationContext = deterministicContext(input.context);
  const explicitGapRequirementIds = input.explicitGapRequirementIds ?? [];
  const validation = validateDraftArtifact(input.artifact, validationContext, {
    explicitGapRequirementIds,
  });
  const evaluation = readinessEvaluation(
    input.artifact,
    input.context,
    validation.issues,
    input.critiqueFindings,
    input,
  );
  const independentReview =
    input.context.modelConfiguration.independentReview ??
    describeIndependentReview(
      input.context.modelConfiguration.author,
      input.context.modelConfiguration.critic,
      { required: input.context.modelConfiguration.requireProviderDiversity },
    );
  const assembledReport = buildIndependentReadinessReport({
    metadata: {
      contextSnapshotId: input.context.id,
      artifact: { id: input.artifact.id, version: input.artifact.version },
      createdAt: input.createdAt,
    },
    summary: "The current artifact was re-evaluated at the human approval boundary.",
    independentReview,
    inputAssessment: { status: "complete", missingInputs: [] },
    evaluation: {
      scores: evaluation.scores,
      thresholdResults: evaluation.thresholdResults,
      meetsRubric: evaluation.meetsRubric,
    },
    deterministicFindings: validation.issues.map((issue, index) =>
      reportFindingFromValidation(input.artifact, issue, index),
    ),
    criticFindings: input.critiqueFindings.map((finding, index) =>
      reportFindingFromCritique(input.artifact, finding, index),
    ),
  });
  // The assembler intentionally returns a deeply frozen view. Parse its
  // stable data back through the persisted contract for the decision API.
  const report = independentReadinessReportSchema.parse(assembledReport);
  return evaluateApplicationReadinessStoppingDecision({
    artifact: input.artifact,
    report,
    ...(input.latestRevisionTrace === undefined
      ? {}
      : { latestRevisionTrace: input.latestRevisionTrace }),
    explicitGapRequirementIds,
    agreements: projectAgreements(report, input.latestRevisionTrace),
    createdAt: input.createdAt,
    deterministicValidationContext: validationContext,
    loopContext: {
      round: input.round,
      maxRounds: input.budget.maxRounds,
      stable: evaluation.stable,
      budgetExhausted: false,
      cancelled: false,
    },
  }) as unknown as ApplicationReadinessStoppingDecision;
}

export function approvedArtifactBinding(artifact: DraftArtifact): ApprovedArtifactBinding {
  return {
    id: artifact.id,
    version: artifact.version,
    checksum: createHash("sha256").update(stableSerializeArtifact(artifact), "utf8").digest("hex"),
  };
}

/** Verify the exact content and readiness decision required before rendering. */
export function assertExactApprovedArtifact(
  artifact: DraftArtifact | null,
  binding: ApprovedArtifactBinding | null | undefined,
  decision: ApplicationReadinessStoppingDecision | null | undefined,
): void {
  if (artifact === null) throw new Error("The approved run has no artifact.");
  if (binding === undefined || binding === null) {
    throw new Error("The run has no exact human-approved artifact binding.");
  }
  if (decision === undefined || decision === null) {
    throw new Error("The run has no application-readiness decision.");
  }
  const parsed = applicationReadinessStoppingDecisionSchema.safeParse(decision);
  if (
    !parsed.success ||
    !parsed.data.applicationReady ||
    parsed.data.humanApprovalRequired !== true
  ) {
    throw new Error("The stored application-readiness decision is not application-ready.");
  }
  const current = approvedArtifactBinding(artifact);
  if (
    binding.id !== current.id ||
    binding.version !== current.version ||
    binding.checksum !== current.checksum ||
    parsed.data.artifact.id !== current.id ||
    parsed.data.artifact.version !== current.version ||
    parsed.data.artifact.createdAt !== artifact.createdAt ||
    parsed.data.artifact.parentVersionId !== artifact.parentVersionId ||
    parsed.data.report.artifact.id !== current.id ||
    parsed.data.report.artifact.version !== current.version
  ) {
    throw new Error("The current artifact does not exactly match the human-approved artifact.");
  }
}
