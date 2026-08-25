import {
  type IndependentReadinessReport,
  type IndependentReadinessReportEvaluation,
  type IndependentReadinessReportFindingInput,
  type IndependentReadinessReportInputAssessment,
  type IndependentReview,
  independentReadinessReportSchema,
  independentReadinessReportSchemaVersion,
} from "@draft-loop/schemas";
import type { ReadinessEvaluation } from "./index.js";

export interface IndependentReadinessReportMetadata {
  readonly contextSnapshotId: string;
  readonly artifact: Readonly<{
    readonly id: string;
    readonly version: number;
  }>;
  readonly createdAt: string;
}

/** The evaluation fields persisted in an independent-readiness report. */
export type IndependentReadinessEvaluationProjection = Pick<
  ReadinessEvaluation,
  "scores" | "thresholdResults" | "meetsRubric"
>;

export interface BuildIndependentReadinessReportInput {
  readonly metadata: IndependentReadinessReportMetadata;
  readonly summary: string;
  readonly independentReview: IndependentReview;
  readonly inputAssessment: IndependentReadinessReportInputAssessment;
  readonly evaluation: IndependentReadinessEvaluationProjection;
  readonly deterministicFindings: readonly IndependentReadinessReportFindingInput[];
  readonly criticFindings: readonly IndependentReadinessReportFindingInput[];
}

type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

export type BuiltIndependentReadinessReport = DeepReadonly<IndependentReadinessReport>;

function findingOrder(
  left: IndependentReadinessReportFindingInput & { readonly origin: "deterministic" | "critic" },
  right: IndependentReadinessReportFindingInput & { readonly origin: "deterministic" | "critic" },
): number {
  const severityOrder = left.severity === "error" ? 0 : 1;
  const rightSeverityOrder = right.severity === "error" ? 0 : 1;
  if (severityOrder !== rightSeverityOrder) {
    return severityOrder - rightSeverityOrder;
  }

  const originOrder = left.origin === "deterministic" ? 0 : 1;
  const rightOriginOrder = right.origin === "deterministic" ? 0 : 1;
  if (originOrder !== rightOriginOrder) {
    return originOrder - rightOriginOrder;
  }

  if (left.id < right.id) {
    return -1;
  }
  if (left.id > right.id) {
    return 1;
  }
  return 0;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }

  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}

/**
 * Assemble a provider-independent readiness report from already enriched
 * findings and a deterministic evaluation projection. This function does not
 * decide application readiness or any loop stopping condition.
 */
export function buildIndependentReadinessReport(
  input: BuildIndependentReadinessReportInput,
): BuiltIndependentReadinessReport {
  const deterministicFindings = input.deterministicFindings.map((finding) => ({
    ...finding,
    origin: "deterministic" as const,
  }));
  const criticFindings = input.criticFindings.map((finding) => ({
    ...finding,
    origin: "critic" as const,
  }));
  const findings = [...deterministicFindings, ...criticFindings].sort(findingOrder);
  const metadata = input.metadata;

  const report = independentReadinessReportSchema.parse({
    schemaVersion: independentReadinessReportSchemaVersion,
    contextSnapshotId: metadata.contextSnapshotId,
    artifact: { ...metadata.artifact },
    createdAt: metadata.createdAt,
    summary: input.summary,
    independentReview: { ...input.independentReview },
    inputAssessment: { ...input.inputAssessment },
    evaluation: {
      scores: input.evaluation.scores.map((score) => ({ ...score })),
      thresholdResults: input.evaluation.thresholdResults.map((thresholdResult) => ({
        ...thresholdResult,
      })),
      meetsRubric: input.evaluation.meetsRubric,
    } satisfies IndependentReadinessReportEvaluation,
    findings,
  });

  return deepFreeze(report) as BuiltIndependentReadinessReport;
}
