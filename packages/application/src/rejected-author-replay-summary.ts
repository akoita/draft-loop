import { z } from "zod";

import { replayRejectedAuthorCapture } from "./rejected-author-replay.js";

const replayBatchSchema = z.array(z.unknown()).min(1).max(100);

export class RejectedAuthorReplayBatchInputError extends Error {
  public constructor() {
    super("Rejected author replay batch input is invalid.");
    this.name = "RejectedAuthorReplayBatchInputError";
  }
}

export interface RejectedAuthorReplayCount {
  readonly value: string;
  readonly count: number;
}

export interface RejectedAuthorReplaySummary {
  readonly total: number;
  readonly accepted: number;
  readonly rejected: number;
  readonly failureStages: readonly RejectedAuthorReplayCount[];
  readonly diagnosticCodes: readonly RejectedAuthorReplayCount[];
}

function sortedCounts(counts: ReadonlyMap<string, number>): readonly RejectedAuthorReplayCount[] {
  return [...counts]
    .sort(([left], [right]) => left.localeCompare(right, "en-US"))
    .map(([value, count]) => ({ value, count }));
}

function increment(counts: Map<string, number>, value: string): void {
  counts.set(value, (counts.get(value) ?? 0) + 1);
}

/** Summarize a bounded private replay batch without returning case content or identity. */
export function summarizeRejectedAuthorReplays(
  captureInputs: unknown,
): RejectedAuthorReplaySummary {
  const parsed = replayBatchSchema.safeParse(captureInputs);
  if (!parsed.success) throw new RejectedAuthorReplayBatchInputError();

  let accepted = 0;
  let rejected = 0;
  const failureStages = new Map<string, number>();
  const diagnosticCodes = new Map<string, number>();

  for (const captureInput of parsed.data) {
    const result = replayRejectedAuthorCapture(captureInput);
    if (result.status === "accepted") {
      accepted += 1;
      continue;
    }

    rejected += 1;
    increment(failureStages, result.failureStage);
    for (const diagnostic of result.diagnostics) increment(diagnosticCodes, diagnostic.code);
  }

  return {
    total: parsed.data.length,
    accepted,
    rejected,
    failureStages: sortedCounts(failureStages),
    diagnosticCodes: sortedCounts(diagnosticCodes),
  };
}
