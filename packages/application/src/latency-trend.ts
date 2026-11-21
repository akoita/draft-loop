import type { RunSpanAttributes, RunSpanName } from "@draft-loop/domain/run-span";

/**
 * Step latency in the daily digest (#3251): each day's finished spans reduced to p50 and p95
 * durations by operation, step and model, then the last seven days compared with the seven
 * before, so the outer loop sees a step that got slower. Durations, counts and model ids only.
 */

export interface DigestLatency {
  /** The span name, such as `invoke_agent` or `retrieve_evidence`. */
  readonly operation: string;
  readonly step: string;
  readonly model: string;
  readonly spans: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
}

interface LatencySpan {
  readonly name: RunSpanName;
  readonly attributes: RunSpanAttributes;
  /** `null` or absent while the span has not ended. */
  readonly durationMs?: number | null;
}

/** The most latency rows one digest lists, the busiest first. */
export const maximumDigestLatencies = 30;

const text = (value: unknown, fallback: string): string =>
  typeof value === "string" && value !== "" ? value : fallback;

/** The nearest-rank percentile of sorted values. */
function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.max(1, Math.ceil(fraction * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1] as number;
}

/** Reduces one day's spans to its latency section; `evaluate_run` has no duration of note. */
export function digestLatency(spans: readonly LatencySpan[]): DigestLatency[] {
  const groups = new Map<
    string,
    { operation: string; step: string; model: string; ms: number[] }
  >();
  for (const span of spans) {
    const ms = span.durationMs;
    if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) continue;
    if (span.name === "evaluate_run") continue;
    const operation = span.name;
    const step = text(span.attributes["draftloop.step"], "none");
    const model = text(span.attributes["gen_ai.request.model"], "none");
    const key = `${operation}\u0000${step}\u0000${model}`;
    const group = groups.get(key) ?? { operation, step, model, ms: [] };
    group.ms.push(ms);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map(({ operation, step, model, ms }) => {
      const sorted = [...ms].sort((a, b) => a - b);
      return {
        operation,
        step,
        model,
        spans: sorted.length,
        p50Ms: Math.round(percentile(sorted, 0.5)),
        p95Ms: Math.round(percentile(sorted, 0.95)),
      };
    })
    .sort(
      (a, b) =>
        b.spans - a.spans ||
        a.operation.localeCompare(b.operation) ||
        a.step.localeCompare(b.step) ||
        a.model.localeCompare(b.model),
    )
    .slice(0, maximumDigestLatencies);
}

export interface LatencyWeek {
  readonly spans: number;
  /** The span-weighted mean of the days' p95; `null` without spans. */
  readonly p95Ms: number | null;
}

export interface LatencyTrendRow {
  readonly operation: string;
  readonly step: string;
  readonly model: string;
  readonly current: LatencyWeek;
  readonly previous: LatencyWeek;
  /** The current week's p95 rose by more than the threshold, with enough spans in both weeks. */
  readonly rose: boolean;
}

export interface LatencyTrend {
  readonly through: string;
  readonly rows: readonly LatencyTrendRow[];
}

/** A rise counts when the week's p95 is this much higher than the week before, relatively. */
export const latencyRiseThreshold = 0.25;
/** Each week needs this many spans of a row before its rise counts. */
export const minimumLatencyTrendSpans = 10;

const dayMs = 24 * 60 * 60 * 1000;

function week(rows: readonly DigestLatency[]): LatencyWeek {
  const spans = rows.reduce((sum, row) => sum + row.spans, 0);
  if (spans === 0) return { spans, p95Ms: null };
  const weighted = rows.reduce((sum, row) => sum + row.p95Ms * row.spans, 0);
  return { spans, p95Ms: Math.round(weighted / spans) };
}

/**
 * Compares the seven days through `through` with the seven before, per operation, step and model.
 * Days whose stored digest predates the latency section count as days with no spans.
 */
export function latencyTrend(
  through: string,
  days: readonly { readonly day: string; readonly latency?: readonly DigestLatency[] }[],
): LatencyTrend {
  const end = Date.parse(`${through}T00:00:00.000Z`);
  const byRow = new Map<
    string,
    {
      operation: string;
      step: string;
      model: string;
      current: DigestLatency[];
      previous: DigestLatency[];
    }
  >();
  for (const day of days) {
    const age = Math.round((end - Date.parse(`${day.day}T00:00:00.000Z`)) / dayMs);
    if (!(age >= 0 && age < 14)) continue;
    for (const row of Array.isArray(day.latency) ? day.latency : []) {
      const key = `${row.operation}\u0000${row.step}\u0000${row.model}`;
      const entry = byRow.get(key) ?? {
        operation: row.operation,
        step: row.step,
        model: row.model,
        current: [],
        previous: [],
      };
      (age < 7 ? entry.current : entry.previous).push(row);
      byRow.set(key, entry);
    }
  }
  const rows = [...byRow.values()].map((entry) => {
    const current = week(entry.current);
    const previous = week(entry.previous);
    const rose =
      current.spans >= minimumLatencyTrendSpans &&
      previous.spans >= minimumLatencyTrendSpans &&
      current.p95Ms !== null &&
      previous.p95Ms !== null &&
      previous.p95Ms > 0 &&
      (current.p95Ms - previous.p95Ms) / previous.p95Ms > latencyRiseThreshold;
    return {
      operation: entry.operation,
      step: entry.step,
      model: entry.model,
      current,
      previous,
      rose,
    };
  });
  rows.sort(
    (a, b) =>
      b.current.spans - a.current.spans ||
      a.operation.localeCompare(b.operation) ||
      a.step.localeCompare(b.step) ||
      a.model.localeCompare(b.model),
  );
  return { through, rows };
}
