/** Safe renderer projection of one persisted application-readiness decision. */
export const approvalReadinessBlockerCodes = [
  "incomplete-report-inputs",
  "independent-review-incomplete",
  "deterministic-error",
  "report-error",
  "unmet-rubric-threshold",
  "disputed-dimension",
  "missing-revision-effect",
] as const;

export const approvalReadinessDimensions = [
  "relevance",
  "evidence",
  "accuracy",
  "differentiation",
  "clarity",
  "format",
  "credibility",
] as const;

export type ApprovalReadinessBlockerCode = (typeof approvalReadinessBlockerCodes)[number];
export type ApprovalReadinessDimension = (typeof approvalReadinessDimensions)[number];

export interface ApprovalReadinessBlocker {
  readonly code: ApprovalReadinessBlockerCode;
  readonly dimension?: ApprovalReadinessDimension;
  readonly score?: number;
  readonly threshold?: number;
}

export interface ApprovalReadiness {
  readonly artifactId: string;
  readonly artifactVersion: number;
  readonly applicationReady: boolean;
  readonly blockers: readonly ApprovalReadinessBlocker[];
  /** True when a person approved this artifact past these failing checks. */
  readonly overridden?: true;
}

export function approvalReadinessForArtifact(
  readiness: ApprovalReadiness | null | undefined,
  artifact: { readonly id: string; readonly version: number },
): ApprovalReadiness | null {
  return readiness?.artifactId === artifact.id && readiness.artifactVersion === artifact.version
    ? readiness
    : null;
}

const readinessKeys = [
  "artifactId",
  "artifactVersion",
  "applicationReady",
  "blockers",
  "overridden",
];
const blockerKeys = ["code", "dimension", "score", "threshold"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOneOf<Value extends string>(value: unknown, values: readonly Value[]): value is Value {
  return typeof value === "string" && values.includes(value as Value);
}

function isScore(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

/** Strictly validates the small content-free shape allowed over the bridge. */
export function normalizeApprovalReadiness(value: unknown): ApprovalReadiness | null {
  if (!isRecord(value) || Object.keys(value).some((key) => !readinessKeys.includes(key))) {
    return null;
  }
  if (
    typeof value.artifactId !== "string" ||
    value.artifactId.length === 0 ||
    value.artifactId.length > 200 ||
    [...value.artifactId].some((character) => character < " " || character === "\u007f") ||
    !Number.isSafeInteger(value.artifactVersion) ||
    (value.artifactVersion as number) < 1 ||
    typeof value.applicationReady !== "boolean" ||
    !Array.isArray(value.blockers) ||
    value.blockers.length > 100 ||
    (value.overridden !== undefined && (value.overridden !== true || value.applicationReady))
  ) {
    return null;
  }

  const blockers: ApprovalReadinessBlocker[] = [];
  for (const rawBlocker of value.blockers) {
    if (
      !isRecord(rawBlocker) ||
      Object.keys(rawBlocker).some((key) => !blockerKeys.includes(key)) ||
      !isOneOf(rawBlocker.code, approvalReadinessBlockerCodes)
    ) {
      return null;
    }
    const dimension = rawBlocker.dimension;
    if (dimension !== undefined && !isOneOf(dimension, approvalReadinessDimensions)) return null;
    const score = rawBlocker.score;
    const threshold = rawBlocker.threshold;
    if (rawBlocker.code === "unmet-rubric-threshold") {
      if (
        !isOneOf(dimension, approvalReadinessDimensions) ||
        !isScore(score) ||
        !isScore(threshold) ||
        score >= threshold
      ) {
        return null;
      }
    } else if (score !== undefined || threshold !== undefined) {
      return null;
    }
    blockers.push({
      code: rawBlocker.code,
      ...(dimension === undefined ? {} : { dimension }),
      ...(score === undefined ? {} : { score }),
      ...(threshold === undefined ? {} : { threshold }),
    });
  }
  if (value.applicationReady !== (blockers.length === 0)) return null;
  return {
    artifactId: value.artifactId,
    artifactVersion: value.artifactVersion as number,
    applicationReady: value.applicationReady,
    blockers,
    ...(value.overridden === true ? { overridden: true as const } : {}),
  };
}

function matchingArtifact(
  identity: unknown,
  artifact: { readonly id: string; readonly version: number },
): boolean {
  if (!isRecord(identity)) return false;
  return identity.id === artifact.id && identity.version === artifact.version;
}

/** Drops stale/malformed decisions and exposes only blocker codes and rubric numbers. */
export function projectApprovalReadiness(
  decision: unknown,
  artifact: { readonly id: string; readonly version: number },
  approvedArtifact?: unknown,
): ApprovalReadiness | null {
  if (!isRecord(decision) || !matchingArtifact(decision.artifact, artifact)) return null;
  if (typeof decision.applicationReady !== "boolean" || !Array.isArray(decision.blockers)) {
    return null;
  }
  const evaluation =
    isRecord(decision.report) && isRecord(decision.report.evaluation)
      ? decision.report.evaluation
      : null;
  const thresholdResults =
    evaluation !== null && Array.isArray(evaluation.thresholdResults)
      ? evaluation.thresholdResults
      : [];
  const blockers: ApprovalReadinessBlocker[] = [];
  for (const rawBlocker of decision.blockers) {
    if (!isRecord(rawBlocker) || !isOneOf(rawBlocker.code, approvalReadinessBlockerCodes)) {
      return null;
    }
    const dimension = rawBlocker.dimension;
    if (dimension !== undefined && !isOneOf(dimension, approvalReadinessDimensions)) return null;
    if (rawBlocker.code === "unmet-rubric-threshold") {
      if (!isOneOf(dimension, approvalReadinessDimensions)) return null;
      const result = thresholdResults.find(
        (entry) => isRecord(entry) && entry.dimension === dimension,
      );
      if (
        !isRecord(result) ||
        result.meets !== false ||
        !isScore(result.score) ||
        !isScore(result.threshold) ||
        result.score >= result.threshold
      ) {
        return null;
      }
      blockers.push({
        code: rawBlocker.code,
        dimension,
        score: result.score,
        threshold: result.threshold,
      });
    } else {
      blockers.push({
        code: rawBlocker.code,
        ...(dimension === undefined ? {} : { dimension }),
      });
    }
  }
  const overridden =
    decision.applicationReady === false &&
    matchingArtifact(approvedArtifact, artifact) &&
    isRecord((approvedArtifact as Record<string, unknown>).readinessOverride);
  return normalizeApprovalReadiness({
    artifactId: artifact.id,
    artifactVersion: artifact.version,
    applicationReady: decision.applicationReady,
    blockers,
    ...(overridden ? { overridden: true } : {}),
  });
}

/** True only for the exact persisted blocker-derived lifecycle error. */
export function isApplicationNotReadyFailure(error: unknown, decision: unknown): boolean {
  if (!(error instanceof Error) || !isRecord(decision) || decision.applicationReady !== false) {
    return false;
  }
  const blockers = decision.blockers;
  if (
    !Array.isArray(blockers) ||
    blockers.length === 0 ||
    blockers.some(
      (blocker) => !isRecord(blocker) || !isOneOf(blocker.code, approvalReadinessBlockerCodes),
    )
  ) {
    return false;
  }
  const codes = blockers.map((blocker) => (blocker as Record<string, unknown>).code).join(", ");
  return error.message === `The current artifact is not application-ready (${codes}).`;
}

/** Fixed, content-free copy for the finite persisted blocker vocabulary. */
export function formatApprovalReadinessBlocker(blocker: ApprovalReadinessBlocker): string {
  if (
    blocker.code === "unmet-rubric-threshold" &&
    blocker.dimension !== undefined &&
    blocker.score !== undefined &&
    blocker.threshold !== undefined
  ) {
    const dimension = `${blocker.dimension[0]?.toUpperCase() ?? ""}${blocker.dimension.slice(1)}`;
    return `${dimension} score ${(blocker.score * 100).toFixed(0)}%; ${(blocker.threshold * 100).toFixed(0)}% required`;
  }
  const labels: Record<ApprovalReadinessBlockerCode, string> = {
    "incomplete-report-inputs": "Readiness report inputs are incomplete",
    "independent-review-incomplete": "Independent readiness review is incomplete",
    "deterministic-error": "A deterministic validation check blocks readiness",
    "report-error": "A readiness report finding blocks application readiness",
    "unmet-rubric-threshold": "A rubric threshold is not met",
    "disputed-dimension": "A readiness dimension remains disputed",
    "missing-revision-effect": "A required revision effect is missing",
  };
  return labels[blocker.code];
}

export const approvalReadinessGuidance =
  "Accepting a finding records your decision but does not change coverage. A low score reflects this check, not a confirmed candidate gap; token matching can miss equivalent phrasing. Review the requirements and coverage evidence, then request a revision when appropriate. If you have checked the draft and still want it, approve it with a recorded reason; the override stays in the run history.";
