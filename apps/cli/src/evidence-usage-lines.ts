import type { RunEvidenceUsage, RunEvidenceUsageCall } from "@draft-loop/application";

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function callLine(call: RunEvidenceUsageCall): string {
  const uncited =
    call.uncitedRanks.length === 0 ? "" : `; uncited ranks ${call.uncitedRanks.join(", ")}`;
  return (
    `round ${call.round} ${call.step}: ${plural(call.sent, "chunk")} sent, ${call.cited} cited` +
    `${uncited}; ${plural(call.claimsOutsideRetrieval, "claim")} outside the retrieved evidence, ` +
    `${call.claimsWithoutEvidence} without evidence`
  );
}

/** The run's evidence usage in words, content-free: counts, ranks and ids only. */
export function evidenceUsageLines(usage: RunEvidenceUsage | undefined): readonly string[] {
  if (usage === undefined) return ["No run recorded."];
  if (usage.calls.length === 0) {
    return [
      `Run ${usage.runId}: no author call recorded the evidence it was sent (a run before this recording, or one without retrieval).`,
    ];
  }
  return [`Run ${usage.runId}: evidence usage`, ...usage.calls.map(callLine)];
}
