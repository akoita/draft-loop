import type { RunSnapshot } from "@draft-loop/orchestrator";
import type { UsageLimitView } from "@draft-loop/ui/model";

/** The usage-limit pause a run records, projected for the review screen; `null` otherwise. */
export function usageLimitView(snapshot: RunSnapshot): UsageLimitView | null {
  const error = snapshot.lastError;
  if (snapshot.state !== "paused" || error === null || error.code !== "usage-limit") return null;
  const resetMs =
    error.usageLimitResetsAt === undefined ? Number.NaN : Date.parse(error.usageLimitResetsAt);
  return {
    provider: error.provider,
    model: error.modelId,
    step: error.step,
    resetsAt: Number.isFinite(resetMs) ? new Date(resetMs).toISOString() : null,
  };
}
