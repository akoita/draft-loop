import { isContentFreeSpanValue, type RunSpanAttributes } from "@draft-loop/domain/run-span";
import type { Critique, ExecutionRecord, RunSnapshot } from "@draft-loop/orchestrator";

/**
 * One run's output quality as content-free numbers and codes (#3237): the critic's verdicts are the
 * online evaluation signal, so production quality can be charted and compared by model without an
 * extra model call. It reads the stored run snapshot, so the daily digest can compute the same
 * record later. It never holds a finding message, a rationale, a requirement or any draft text.
 */
export interface RunQuality {
  readonly state: string;
  readonly round: number;
  /** The last completed author and critic models; `null` when that step never completed. */
  readonly authorModel: string | null;
  readonly criticModel: string | null;
  /** Whether a fallback critic served any call of the run (#3122). */
  readonly criticFallback: boolean;
  readonly readiness: RunQualityReadiness | null;
  readonly findings: RunQualityFindings;
  readonly coverage: RunQualityCoverage;
  readonly estimatedUsd: number;
}

export interface RunQualityReadiness {
  readonly status: string;
  readonly stopReason: string;
  readonly ready: boolean;
  readonly meetsRubric: boolean;
  readonly bestAvailable: boolean;
  /** Each readiness dimension's score, by dimension name. */
  readonly scores: Readonly<Record<string, number>>;
}

export interface RunQualityFindings {
  readonly total: number;
  readonly errors: number;
  readonly warnings: number;
  /** Counts by category, then by code, the most frequent first; codes are closed identifiers. */
  readonly byCategory: readonly RunQualityCount[];
  readonly byCode: readonly RunQualityCount[];
}

export interface RunQualityCoverage {
  /** The last critic's requirement verdicts; zero when it was not asked to judge coverage. */
  readonly judged: number;
  readonly satisfied: number;
  readonly notSatisfied: number;
  /** Requirements the open findings report as uncovered or as an explicit gap. */
  readonly uncovered: number;
}

export interface RunQualityCount {
  readonly code: string;
  readonly count: number;
}

/** The most codes one record lists; the rest are summed under `other`. */
export const maximumRunQualityCodes = 20;

const uncoveredCodes: ReadonlySet<string> = new Set(["uncovered-requirement", "explicit-gap"]);

/** A code that is not a short plain identifier could hold text, so it is counted as `other`. */
const closedCode = (code: unknown): string =>
  typeof code === "string" && isContentFreeSpanValue(code) ? code : "other";

const finite = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

function counted(codes: readonly string[]): RunQualityCount[] {
  const counts = new Map<string, number>();
  for (const code of codes) counts.set(code, (counts.get(code) ?? 0) + 1);
  const sorted = [...counts]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
  if (sorted.length <= maximumRunQualityCodes) return sorted;
  const kept = sorted.slice(0, maximumRunQualityCodes - 1);
  const rest = sorted.slice(maximumRunQualityCodes - 1).reduce((sum, c) => sum + c.count, 0);
  return [...kept, { code: "other", count: rest }];
}

function lastCompleted(
  history: readonly ExecutionRecord[],
  step: ExecutionRecord["step"],
): ExecutionRecord | undefined {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const record = history[index];
    if (record?.step === step && record.status === "completed") return record;
  }
  return undefined;
}

const model = (record: ExecutionRecord | undefined): string | null =>
  record === undefined ? null : closedCode(record.modelId);

export type RunQualityInput = Pick<
  RunSnapshot,
  "state" | "round" | "findings" | "latestEvaluation" | "executionHistory" | "totalCostUsd"
>;

export function runQuality(run: RunQualityInput): RunQuality {
  const critic = lastCompleted(run.executionHistory, "critic");
  const judgements = (critic?.output as Critique | undefined)?.coverageJudgements ?? [];
  const satisfied = judgements.filter((judgement) => judgement.verdict === "satisfied").length;
  const evaluation = run.latestEvaluation;
  const errors = run.findings.filter((finding) => finding.severity === "error").length;
  return {
    state: closedCode(run.state),
    round: finite(run.round),
    authorModel: model(
      lastCompleted(run.executionHistory, "revision") ??
        lastCompleted(run.executionHistory, "author"),
    ),
    criticModel: model(critic),
    criticFallback: run.executionHistory.some((record) => record.criticFallback !== undefined),
    readiness:
      evaluation === null
        ? null
        : {
            status: closedCode(evaluation.status),
            stopReason: closedCode(evaluation.stopReason),
            ready: evaluation.ready === true,
            meetsRubric: evaluation.meetsRubric === true,
            bestAvailable: evaluation.bestAvailable === true,
            scores: Object.fromEntries(
              Object.entries(evaluation.scoreVector).map(([dimension, score]) => [
                closedCode(dimension),
                finite(score),
              ]),
            ),
          },
    findings: {
      total: run.findings.length,
      errors,
      warnings: run.findings.length - errors,
      byCategory: counted(run.findings.map((finding) => closedCode(finding.category ?? "none"))),
      byCode: counted(run.findings.map((finding) => closedCode(finding.code))),
    },
    coverage: {
      judged: judgements.length,
      satisfied,
      notSatisfied: judgements.length - satisfied,
      uncovered: new Set(
        run.findings
          .filter((finding) => uncoveredCodes.has(finding.code))
          .map((finding) => finding.requirementId ?? finding.code),
      ).size,
    },
    estimatedUsd: Math.round(finite(run.totalCostUsd) * 1_000_000) / 1_000_000,
  };
}

/** States where the critic's last verdict stands, so the run's quality is worth recording. */
const qualityStates: ReadonlySet<string> = new Set([
  "awaiting-approval",
  "budget-exhausted",
  "stopped",
]);

/**
 * Whether a job brought the run to a state where its draft waits or stops: the moment its quality
 * is recorded, once per arrival.
 */
export function reachedQualityState(
  after: Pick<RunQualityInput, "state" | "round">,
  before?: Pick<RunQualityInput, "state" | "round">,
): boolean {
  if (!qualityStates.has(after.state)) return false;
  return before === undefined || before.state !== after.state || before.round !== after.round;
}

/** The mean of the readiness dimension scores, to four decimals; `null` without readiness. */
export function meanReadiness(quality: RunQuality): number | null {
  const scores = Object.values(quality.readiness?.scores ?? {});
  if (scores.length === 0) return null;
  const mean = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  return Math.round(mean * 10_000) / 10_000;
}

/** The quality record as `evaluate_run` span attributes, for the span store and the digest. */
export function runQualitySpanAttributes(quality: RunQuality): RunSpanAttributes {
  const readiness = meanReadiness(quality);
  return {
    "gen_ai.operation.name": "evaluate_run",
    ...(quality.criticModel === null ? {} : { "gen_ai.request.model": quality.criticModel }),
    ...(quality.authorModel === null
      ? {}
      : { "draftloop.quality.author_model": quality.authorModel }),
    "draftloop.round": quality.round,
    "draftloop.estimated_usd": quality.estimatedUsd,
    "draftloop.quality.state": quality.state,
    "draftloop.quality.ready": quality.readiness?.ready === true,
    ...(quality.readiness === null
      ? {}
      : { "draftloop.quality.stop_reason": quality.readiness.stopReason }),
    ...(readiness === null ? {} : { "draftloop.quality.readiness": readiness }),
    "draftloop.quality.uncovered": quality.coverage.uncovered,
    "draftloop.quality.error_findings": quality.findings.errors,
  };
}
