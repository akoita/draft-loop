/**
 * A run's trace as the steps a person reads in Run details (#2693): each time the server advanced
 * the run, and inside it each author, critic or revision attempt with how long it took, the model
 * it called, what it cost and, when it failed, the error type.
 */
import type { RunTraceSpanView } from "./run-trace-contract.js";

export type RunStepKind = "author" | "critic" | "revision";

export interface RunStepAttempt {
  readonly spanId: string;
  /** Null when the span named no step this screen knows. */
  readonly step: RunStepKind | null;
  readonly round: number | null;
  /** 1 for the first try; 2 and up are retries. */
  readonly attempt: number | null;
  /** Null when the attempt never finished. */
  readonly durationMs: number | null;
  readonly model: string | null;
  readonly estimatedUsd: number | null;
  readonly failed: boolean;
  /** The error's type, e.g. `rate-limited`; null when the attempt did not fail or named none. */
  readonly errorType: string | null;
}

export interface RunStepAdvance {
  readonly spanId: string;
  readonly startedAt: string;
  readonly durationMs: number | null;
  readonly failed: boolean;
  readonly attempts: readonly RunStepAttempt[];
}

function durationMs(span: RunTraceSpanView): number | null {
  if (span.endedAt === null) return null;
  const elapsed = Date.parse(span.endedAt) - Date.parse(span.startedAt);
  return Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : null;
}

function numberOf(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringOf(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function stepKind(value: unknown): RunStepKind | null {
  return value === "author" || value === "critic" || value === "revision" ? value : null;
}

function attempt(span: RunTraceSpanView): RunStepAttempt {
  const failed = span.status === "error";
  return {
    spanId: span.spanId,
    step: stepKind(span.attributes["draftloop.step"]),
    round: numberOf(span.attributes["draftloop.round"]),
    attempt: numberOf(span.attributes["draftloop.attempt"]),
    durationMs: durationMs(span),
    model: stringOf(span.attributes["gen_ai.request.model"]),
    estimatedUsd: numberOf(span.attributes["draftloop.estimated_usd"]),
    failed,
    errorType: failed ? stringOf(span.attributes["error.type"]) : null,
  };
}

/**
 * The advances of a run in start order, each with its attempts. An advance that called no model
 * (the run was already waiting on the person) is left out, and so is an attempt whose advance is
 * missing from the trace: a partial trace shows less, never a guess.
 */
export function runStepAdvances(spans: readonly RunTraceSpanView[]): readonly RunStepAdvance[] {
  const attemptsByAdvance = new Map<string, RunStepAttempt[]>();
  for (const span of spans) {
    if (span.name !== "invoke_agent" || span.parentSpanId === null) continue;
    const attempts = attemptsByAdvance.get(span.parentSpanId) ?? [];
    attempts.push(attempt(span));
    attemptsByAdvance.set(span.parentSpanId, attempts);
  }
  return spans
    .filter((span) => span.name === "invoke_workflow")
    .map((span) => {
      const attempts = attemptsByAdvance.get(span.spanId) ?? [];
      return {
        spanId: span.spanId,
        startedAt: span.startedAt,
        durationMs: durationMs(span),
        failed: span.status === "error" || attempts.some((entry) => entry.failed),
        attempts,
      };
    })
    .filter((advance) => advance.attempts.length > 0);
}

/** The estimated cost of every attempt, or null when none recorded one. */
export function runStepsEstimatedUsd(advances: readonly RunStepAdvance[]): number | null {
  const costs = advances.flatMap((advance) =>
    advance.attempts.flatMap((entry) => (entry.estimatedUsd === null ? [] : [entry.estimatedUsd])),
  );
  return costs.length === 0 ? null : costs.reduce((sum, cost) => sum + cost, 0);
}
