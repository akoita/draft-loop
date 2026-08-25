import type {
  ApplicationReadinessStoppingDecisionStopReason,
  ReadinessDimension,
} from "@draft-loop/domain";
import {
  type AdjudicatedRevisionTrace,
  type ApplicationReadinessDeterministicCheck,
  type ApplicationReadinessStoppingDecision,
  type ApplicationReadinessStoppingDecisionBlocker,
  type ApplicationReadinessStoppingDecisionLimitation,
  adjudicatedRevisionTraceSchema,
  applicationReadinessStoppingDecisionSchema,
  applicationReadinessStoppingDecisionSchemaVersion,
  type DraftArtifact,
  draftArtifactSchema,
  type IndependentReadinessReport,
  independentReadinessReportSchema,
  type ReadinessDimensionAgreement,
} from "@draft-loop/schemas";
import { type DeterministicValidationContext, validateDraftArtifact } from "@draft-loop/validation";

export interface ApplicationReadinessStoppingLoopContext {
  readonly round: number;
  readonly maxRounds: number;
  readonly stable: boolean;
  readonly budgetExhausted: boolean;
  readonly cancelled: boolean;
}

interface ApplicationReadinessStoppingDecisionInputBase {
  readonly artifact: DraftArtifact;
  readonly report: IndependentReadinessReport;
  readonly latestRevisionTrace?: AdjudicatedRevisionTrace;
  readonly explicitGapRequirementIds?: readonly string[];
  readonly agreements: readonly ReadinessDimensionAgreement[];
  readonly createdAt: string;
}

export type EvaluateApplicationReadinessStoppingDecisionInput =
  ApplicationReadinessStoppingDecisionInputBase & {
    readonly deterministicValidationContext: DeterministicValidationContext;
    readonly loopContext: ApplicationReadinessStoppingLoopContext;
  };

type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

export type BuiltApplicationReadinessStoppingDecision =
  DeepReadonly<ApplicationReadinessStoppingDecision>;

const readinessCategories = ["format", "factuality", "coverage", "evidence", "quality"] as const;

type StoppingReference = {
  readonly code: string;
  readonly checkCode?: string | undefined;
  readonly findingId?: string | undefined;
  readonly inputId?: string | undefined;
  readonly dimension?: ReadinessDimension | undefined;
  readonly claimId?: string | undefined;
  readonly sectionId?: string | undefined;
  readonly requirementId?: string | undefined;
};

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }

  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer`);
  }
}

function assertBoolean(value: unknown, name: string): asserts value is boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`${name} must be a boolean`);
  }
}

function assertCanonicalInputKeys(input: EvaluateApplicationReadinessStoppingDecisionInput): void {
  const allowedKeys = new Set([
    "artifact",
    "report",
    "latestRevisionTrace",
    "explicitGapRequirementIds",
    "agreements",
    "createdAt",
    "deterministicValidationContext",
    "loopContext",
  ]);
  for (const key of Object.keys(input as object)) {
    if (!allowedKeys.has(key)) {
      throw new TypeError(`Unknown stopping decision input field: ${key}`);
    }
  }
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function referenceKey(reference: StoppingReference): string {
  return [
    reference.code,
    reference.checkCode,
    reference.findingId,
    reference.inputId,
    reference.dimension,
    reference.claimId,
    reference.sectionId,
    reference.requirementId,
  ]
    .map((value) => value ?? "")
    .join("\u0000");
}

function deterministicCheckKey(check: ApplicationReadinessDeterministicCheck): string {
  return [
    check.code,
    check.severity,
    check.category,
    check.claimId,
    check.sectionId,
    check.requirementId,
  ]
    .map((value) => value ?? "")
    .join("\u0000");
}

function orderReferences<T extends StoppingReference>(references: readonly T[]): readonly T[] {
  return [...references].sort((left, right) =>
    compareStrings(referenceKey(left), referenceKey(right)),
  );
}

function optionalFindingReferences(finding: {
  readonly claimId?: string | undefined;
  readonly sectionId?: string | undefined;
  readonly requirementId?: string | undefined;
}): Pick<StoppingReference, "claimId" | "sectionId" | "requirementId"> {
  return {
    ...(finding.claimId === undefined ? {} : { claimId: finding.claimId }),
    ...(finding.sectionId === undefined ? {} : { sectionId: finding.sectionId }),
    ...(finding.requirementId === undefined ? {} : { requirementId: finding.requirementId }),
  };
}

function projectDeterministicChecks(
  issues: readonly {
    readonly code: string;
    readonly severity: "error" | "warning";
    readonly category?: (typeof readinessCategories)[number];
    readonly claimId?: string;
    readonly sectionId?: string;
    readonly requirementId?: string;
  }[],
): readonly ApplicationReadinessDeterministicCheck[] {
  const checks: ApplicationReadinessDeterministicCheck[] = [];
  const seen = new Set<string>();
  for (const issue of issues) {
    if (issue.category === undefined) {
      throw new Error("Deterministic validation issues must include a category.");
    }
    const check = {
      code: issue.code,
      severity: issue.severity,
      category: issue.category,
      ...optionalFindingReferences(issue),
    } satisfies ApplicationReadinessDeterministicCheck;
    const key = deterministicCheckKey(check);
    if (!seen.has(key)) {
      checks.push(check);
      seen.add(key);
    }
  }
  return checks.sort((left, right) =>
    compareStrings(deterministicCheckKey(left), deterministicCheckKey(right)),
  );
}

function targetReferences(
  target: IndependentReadinessReport["findings"][number]["target"],
): Pick<StoppingReference, "dimension" | "claimId" | "sectionId" | "requirementId"> {
  switch (target.kind) {
    case "rubric":
      return { dimension: target.id };
    case "claim":
      return { claimId: target.id };
    case "section":
      return { sectionId: target.id };
    case "requirement":
      return { requirementId: target.id };
    case "artifact":
    case "evidence":
      return {};
  }
}

function createBlockers(
  report: IndependentReadinessReport,
  deterministicChecks: readonly ApplicationReadinessDeterministicCheck[],
  agreements: readonly ReadinessDimensionAgreement[],
  latestRevisionTrace: AdjudicatedRevisionTrace | undefined,
): readonly ApplicationReadinessStoppingDecisionBlocker[] {
  const blockers: ApplicationReadinessStoppingDecisionBlocker[] = [];

  if (report.inputAssessment.status === "incomplete") {
    for (const inputId of report.inputAssessment.missingInputs) {
      blockers.push({ code: "incomplete-report-inputs", inputId });
    }
  }

  const independentReview = report.independentReview;
  if (
    !independentReview.required ||
    (!independentReview.lineagesDistinct && independentReview.overrideRationale === undefined)
  ) {
    blockers.push({ code: "independent-review-incomplete" });
  }

  for (const check of deterministicChecks) {
    if (check.severity !== "error") continue;
    blockers.push({
      code: "deterministic-error",
      checkCode: check.code,
      ...optionalFindingReferences(check),
    });
  }

  for (const finding of report.findings) {
    if (finding.severity !== "error") continue;
    blockers.push({
      code: "report-error",
      findingId: finding.id,
      ...targetReferences(finding.target),
    });
  }

  for (const thresholdResult of report.evaluation.thresholdResults) {
    if (!thresholdResult.meets) {
      blockers.push({
        code: "unmet-rubric-threshold",
        dimension: thresholdResult.dimension,
      });
    }
  }

  for (const agreement of agreements) {
    if (agreement.status === "disputed") {
      blockers.push({ code: "disputed-dimension", dimension: agreement.dimension });
    }
  }

  if (latestRevisionTrace !== undefined) {
    const decisionsById = new Map(
      latestRevisionTrace.adjudication.decisions.map((decision) => [decision.findingId, decision]),
    );
    for (const effect of latestRevisionTrace.effects) {
      const decision = decisionsById.get(effect.findingId);
      if (decision?.disposition === "accept" && effect.status === "missing") {
        blockers.push({ code: "missing-revision-effect", findingId: effect.findingId });
      }
    }
  }

  return orderReferences(blockers) as readonly ApplicationReadinessStoppingDecisionBlocker[];
}

function createLimitations(
  report: IndependentReadinessReport,
  deterministicChecks: readonly ApplicationReadinessDeterministicCheck[],
  latestRevisionTrace: AdjudicatedRevisionTrace | undefined,
): readonly ApplicationReadinessStoppingDecisionLimitation[] {
  const limitations: ApplicationReadinessStoppingDecisionLimitation[] = [];

  for (const check of deterministicChecks) {
    if (check.severity !== "warning") continue;
    limitations.push({
      code: "deterministic-warning",
      checkCode: check.code,
      ...optionalFindingReferences(check),
    });
  }

  for (const finding of report.findings) {
    if (finding.severity !== "warning") continue;
    limitations.push({
      code: "report-warning",
      findingId: finding.id,
      ...targetReferences(finding.target),
    });
  }

  if (latestRevisionTrace !== undefined) {
    for (const effect of latestRevisionTrace.effects) {
      if (effect.status === "overridden") {
        limitations.push({
          code: "revision-effect-overridden",
          findingId: effect.findingId,
        });
      } else if (effect.status === "disagreement-preserved") {
        limitations.push({
          code: "disagreement-preserved",
          findingId: effect.findingId,
        });
      }
    }
  }

  return orderReferences(limitations) as readonly ApplicationReadinessStoppingDecisionLimitation[];
}

function assertArtifactReportIdentity(
  artifact: DraftArtifact,
  report: IndependentReadinessReport,
): void {
  if (artifact.id !== report.artifact.id || artifact.version !== report.artifact.version) {
    throw new Error("The artifact must match the readiness report artifact identity.");
  }
  if (Date.parse(report.createdAt) < Date.parse(artifact.createdAt)) {
    throw new Error("The readiness report must not precede artifact creation.");
  }
}

function assertTraceIdentity(
  trace: AdjudicatedRevisionTrace,
  artifact: DraftArtifact,
  report: IndependentReadinessReport,
): void {
  if (
    trace.revisedArtifact.id !== artifact.id ||
    trace.revisedArtifact.version !== artifact.version ||
    trace.revisedArtifact.parentVersionId !== artifact.parentVersionId ||
    trace.revisedArtifact.id !== report.artifact.id ||
    trace.revisedArtifact.version !== report.artifact.version
  ) {
    throw new Error("The revision trace must match the current artifact and readiness report.");
  }
  if (trace.adjudication.contextSnapshotId !== report.contextSnapshotId) {
    throw new Error("The revision trace context must match the readiness report context.");
  }
  if (Date.parse(report.createdAt) < Date.parse(trace.createdAt)) {
    throw new Error("The readiness report must not precede its revision trace.");
  }
}

function stopReason(
  applicationReady: boolean,
  loop: ApplicationReadinessStoppingLoopContext,
): ApplicationReadinessStoppingDecisionStopReason {
  if (applicationReady) return "application-ready";
  if (loop.cancelled) return "cancelled";
  if (loop.budgetExhausted) return "budget-exhausted";
  if (loop.round >= loop.maxRounds) return "max-rounds";
  if (loop.stable) return "stable-convergence";
  return "continue";
}

/**
 * Evaluate one validated artifact/report pair against strict application-
 * readiness and bounded-loop rules. The result is a local, provider-neutral
 * stopping decision; it never implies human approval.
 */
export function evaluateApplicationReadinessStoppingDecision(
  input: EvaluateApplicationReadinessStoppingDecisionInput,
): BuiltApplicationReadinessStoppingDecision {
  assertCanonicalInputKeys(input);
  const artifact = draftArtifactSchema.parse(input.artifact);
  const report = independentReadinessReportSchema.parse(input.report);
  const latestRevisionTrace =
    input.latestRevisionTrace === undefined
      ? undefined
      : adjudicatedRevisionTraceSchema.parse(input.latestRevisionTrace);
  assertPositiveInteger(input.loopContext.round, "loopContext.round");
  assertPositiveInteger(input.loopContext.maxRounds, "loopContext.maxRounds");
  assertBoolean(input.loopContext.stable, "loopContext.stable");
  assertBoolean(input.loopContext.budgetExhausted, "loopContext.budgetExhausted");
  assertBoolean(input.loopContext.cancelled, "loopContext.cancelled");

  assertArtifactReportIdentity(artifact, report);
  if (latestRevisionTrace !== undefined) {
    assertTraceIdentity(latestRevisionTrace, artifact, report);
  }

  const validation = validateDraftArtifact(artifact, input.deterministicValidationContext, {
    explicitGapRequirementIds: input.explicitGapRequirementIds ?? [],
  });
  const deterministicChecks = projectDeterministicChecks(validation.issues);
  const parsedAgreements = applicationReadinessStoppingDecisionSchema.shape.agreements.parse(
    input.agreements,
  );
  const blockers = createBlockers(
    report,
    deterministicChecks,
    parsedAgreements,
    latestRevisionTrace,
  );
  const limitations = createLimitations(report, deterministicChecks, latestRevisionTrace);
  const applicationReady = blockers.length === 0;
  const reason = stopReason(applicationReady, input.loopContext);
  const shouldStop = reason !== "continue";

  const decision = applicationReadinessStoppingDecisionSchema.parse({
    schemaVersion: applicationReadinessStoppingDecisionSchemaVersion,
    contextSnapshotId: report.contextSnapshotId,
    artifact: {
      id: artifact.id,
      version: artifact.version,
      createdAt: artifact.createdAt,
      parentVersionId: artifact.parentVersionId,
    },
    createdAt: input.createdAt,
    report,
    ...(latestRevisionTrace === undefined ? {} : { latestRevisionTrace }),
    deterministicChecks,
    agreements: parsedAgreements,
    blockers,
    limitations,
    loopContext: input.loopContext,
    applicationReady,
    shouldStop,
    bestAvailable: shouldStop && !applicationReady,
    stopReason: reason,
    humanApprovalRequired: true,
  });

  return deepFreeze(decision) as BuiltApplicationReadinessStoppingDecision;
}
