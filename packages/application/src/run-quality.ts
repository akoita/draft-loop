import { isContentFreeSpanValue } from "@draft-loop/domain/run-span";
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
