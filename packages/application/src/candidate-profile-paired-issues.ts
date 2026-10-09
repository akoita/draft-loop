/** Conflict and duplicate issues only make sense between at least two distinct facts. */
export function isPairedProfileIssueCode(code: string): boolean {
  return code.startsWith("conflict-") || code === "duplicate";
}

/** Whether an issue with this code still names enough distinct facts to be kept. */
export function hasEnoughDistinctFactsForIssue(code: string, factIds: readonly string[]): boolean {
  return !isPairedProfileIssueCode(code) || new Set(factIds).size >= 2;
}
