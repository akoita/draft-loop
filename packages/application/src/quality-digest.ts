import type { RunSpanAttributes, RunSpanName, RunSpanStatus } from "@draft-loop/domain/run-span";

/**
 * The daily quality digest (#2916): one day's run spans across every organisation, reduced to
 * counts and run ids for the outer loop's diagnosis (#2914). Spans are content-free by
 * construction, and the digest keeps only codes, model ids, counts and at most a few run ids per
 * pattern, so it may be logged and read by an operator's agent.
 */

/** One stored span, as the sweep reads it. */
export interface QualityDigestSpan {
  readonly runId: string;
  readonly name: RunSpanName;
  readonly status: RunSpanStatus | null;
  readonly attributes: RunSpanAttributes;
}

export interface QualityDigestAttempts {
  readonly step: string;
  readonly model: string;
  readonly ok: number;
  readonly error: number;
}

export interface QualityDigestFailure {
  readonly step: string;
  readonly model: string;
  readonly errorType: string;
  readonly failureStage: string | null;
  readonly failureReason: string | null;
  readonly count: number;
  /** At most three runs that show the pattern, to read their traces. */
  readonly runIds: readonly string[];
}

export interface QualityDigestCount {
  readonly code: string;
  readonly count: number;
}

export interface QualityDigest {
  /** The UTC day the digest covers, as YYYY-MM-DD. */
  readonly day: string;
  readonly organisations: number;
  readonly runs: number;
  readonly estimatedUsd: number;
  readonly attempts: readonly QualityDigestAttempts[];
  readonly failures: readonly QualityDigestFailure[];
  readonly revisionModes: readonly QualityDigestCount[];
  readonly patchRejections: readonly QualityDigestCount[];
  readonly retrieval: {
    readonly calls: number;
    /** Calls that retrieved nothing. */
    readonly empty: number;
    /** Calls whose chunks all came from one source. */
    readonly singleSource: number;
    readonly medianChunks: number;
  };
}

/** The most failure patterns one digest lists, the most frequent first. */
export const maximumDigestFailures = 20;
const sampleRunIds = 3;

const text = (value: unknown, fallback: string): string =>
  typeof value === "string" && value !== "" ? value : fallback;
const number = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

function counted(counts: Map<string, number>): QualityDigestCount[] {
  return [...counts]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

/** Reduces one day's spans to the digest. */
export function buildQualityDigest(input: {
  readonly day: string;
  readonly organisations: number;
  readonly spans: readonly QualityDigestSpan[];
}): QualityDigest {
  const runs = new Set<string>();
  const attempts = new Map<string, { step: string; model: string; ok: number; error: number }>();
  const failures = new Map<
    string,
    Omit<QualityDigestFailure, "runIds" | "count"> & { count: number; runIds: Set<string> }
  >();
  const modes = new Map<string, number>();
  const rejections = new Map<string, number>();
  const chunkCounts: number[] = [];
  let empty = 0;
  let singleSource = 0;
  let estimatedUsd = 0;

  for (const span of input.spans) {
    runs.add(span.runId);
    const a = span.attributes;
    if (span.name === "retrieve_evidence" && span.status === "ok") {
      const chunks = number(a["draftloop.retrieved_chunks"]) ?? 0;
      chunkCounts.push(chunks);
      if (chunks === 0) empty += 1;
      else if (number(a["draftloop.retrieved_sources"]) === 1) singleSource += 1;
      continue;
    }
    if (span.name !== "invoke_agent" || span.status === null) continue;
    const step = text(a["draftloop.step"], "unknown");
    const model = text(a["gen_ai.request.model"], "unknown");
    estimatedUsd += number(a["draftloop.estimated_usd"]) ?? 0;
    const attemptKey = `${step}\u0000${model}`;
    const attempt = attempts.get(attemptKey) ?? { step, model, ok: 0, error: 0 };
    attempt[span.status] += 1;
    attempts.set(attemptKey, attempt);

    const mode = a["draftloop.revision.mode"];
    if (typeof mode === "string") modes.set(mode, (modes.get(mode) ?? 0) + 1);
    const rejection = a["draftloop.revision.patch_rejection"];
    if (typeof rejection === "string") {
      rejections.set(rejection, (rejections.get(rejection) ?? 0) + 1);
    }

    if (span.status !== "error") continue;
    const errorType = text(a["error.type"], "unknown");
    const failureStage =
      typeof a["draftloop.failure_stage"] === "string" ? a["draftloop.failure_stage"] : null;
    const failureReason =
      typeof a["draftloop.failure_reason"] === "string" ? a["draftloop.failure_reason"] : null;
    const key = [step, model, errorType, failureStage ?? "", failureReason ?? ""].join("\u0000");
    const failure = failures.get(key) ?? {
      step,
      model,
      errorType,
      failureStage,
      failureReason,
      count: 0,
      runIds: new Set<string>(),
    };
    failure.count += 1;
    if (failure.runIds.size < sampleRunIds) failure.runIds.add(span.runId);
    failures.set(key, failure);
  }

  return {
    day: input.day,
    organisations: input.organisations,
    runs: runs.size,
    estimatedUsd: Math.round(estimatedUsd * 10_000) / 10_000,
    attempts: [...attempts.values()].sort(
      (a, b) => a.step.localeCompare(b.step) || a.model.localeCompare(b.model),
    ),
    failures: [...failures.values()]
      .sort((a, b) => b.count - a.count || a.step.localeCompare(b.step))
      .slice(0, maximumDigestFailures)
      .map((failure) => ({ ...failure, runIds: [...failure.runIds] })),
    revisionModes: counted(modes),
    patchRejections: counted(rejections),
    retrieval: {
      calls: chunkCounts.length,
      empty,
      singleSource,
      medianChunks: median(chunkCounts),
    },
  };
}
