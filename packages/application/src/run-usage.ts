import type { ExecutionRecord } from "@draft-loop/orchestrator";

/** What one company, model and route used: content-free counts and amounts only. */
export interface UsageLine {
  readonly company: string;
  readonly model: string;
  /** The endpoint that served the calls; `null` for calls recorded before routes were. */
  readonly route: string | null;
  readonly calls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** The priced calls' estimated cost; unpriced calls add nothing and are counted apart. */
  readonly estimatedUsd: number;
  readonly unpricedCalls: number;
}

export interface UsageSummary {
  readonly calls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly estimatedUsd: number;
  readonly unpricedCalls: number;
  readonly lines: readonly UsageLine[];
}

/** Sums of floating-point estimates keep six decimals, below any provider's billing unit. */
const roundUsd = (value: number) => Math.round(value * 1_000_000) / 1_000_000;

function addLine(into: Map<string, UsageLine>, line: UsageLine): void {
  const key = JSON.stringify([line.company, line.model, line.route]);
  const current = into.get(key);
  into.set(
    key,
    current === undefined
      ? line
      : {
          ...current,
          calls: current.calls + line.calls,
          inputTokens: current.inputTokens + line.inputTokens,
          outputTokens: current.outputTokens + line.outputTokens,
          estimatedUsd: current.estimatedUsd + line.estimatedUsd,
          unpricedCalls: current.unpricedCalls + line.unpricedCalls,
        },
  );
}

/**
 * Totals usage lines, merging those of one company, model and route, in first-seen order. Storage
 * that already groups its rows passes them through unchanged.
 */
export function summarizeUsage(lines: readonly UsageLine[]): UsageSummary {
  const merged = new Map<string, UsageLine>();
  for (const line of lines) addLine(merged, line);
  const grouped = [...merged.values()];
  // The total sums unrounded amounts, so many small calls are not each rounded away.
  return {
    calls: grouped.reduce((sum, line) => sum + line.calls, 0),
    inputTokens: grouped.reduce((sum, line) => sum + line.inputTokens, 0),
    outputTokens: grouped.reduce((sum, line) => sum + line.outputTokens, 0),
    estimatedUsd: roundUsd(grouped.reduce((sum, line) => sum + line.estimatedUsd, 0)),
    unpricedCalls: grouped.reduce((sum, line) => sum + line.unpricedCalls, 0),
    lines: grouped.map((line) => ({ ...line, estimatedUsd: roundUsd(line.estimatedUsd) })),
  };
}

/** A run's usage from its completed calls; a failed attempt records no usage. */
export function runUsage(history: readonly ExecutionRecord[]): UsageSummary {
  return summarizeUsage(
    history
      .filter((record) => record.status === "completed")
      .map((record) => ({
        company: record.provider,
        model: record.modelId,
        route: record.route ?? null,
        calls: 1,
        inputTokens: record.inputTokens,
        outputTokens: record.outputTokens,
        estimatedUsd: record.estimatedUsd ?? 0,
        unpricedCalls: record.estimatedUsd === null ? 1 : 0,
      })),
  );
}
