import { WORD_MATCH_COVERAGE_CODE } from "./finding-decision-help.js";
import { isUnresolvedFinding, type ReviewFinding } from "./model.js";

/**
 * A word-match miss on a critical requirement blocks only when the critic also reports the gap
 * (#1789, #1872), so a blocking one is a real evidence gap: no revision can fill it from the
 * approved evidence. The review names it as a gap and settles all of them in one step (#1873).
 */
export const KNOWN_GAP_RATIONALE =
  "Known gap: the approved evidence does not support this requirement";

export const CONFIRMED_GAP_TITLE_PREFIX = "No evidence found for: ";

/** Whether a finding is a word-match miss the critic confirmed as a gap. */
export function isConfirmedCoverageGap(finding: Pick<ReviewFinding, "code" | "severity">): boolean {
  return finding.code === WORD_MATCH_COVERAGE_CODE && finding.severity === "error";
}

/** The confirmed gaps still waiting for a decision, in queue order. */
export function pendingConfirmedGapIds(findings: readonly ReviewFinding[]): readonly string[] {
  return findings
    .filter((finding) => isConfirmedCoverageGap(finding) && isUnresolvedFinding(finding))
    .map((finding) => finding.id);
}

/** The one-step action's label, or null when no confirmed gap is pending. */
export function markKnownGapsLabel(count: number): string | null {
  if (count === 0) return null;
  return `Mark ${count === 1 ? "1 confirmed gap" : `${count} confirmed gaps`} as known`;
}

export const MARK_KNOWN_GAPS_NOTE =
  "The critic agrees the evidence does not cover these requirements, so no revision can fix them. Marking them as known records an override with that reason and unblocks approval; you can change each one later.";
