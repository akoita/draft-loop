import type { ApprovalReadiness } from "./approval-readiness.js";
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

/** The longest readiness override reason the approve action carries. */
const MAXIMUM_OVERRIDE_RATIONALE_LENGTH = 500;

/**
 * The readiness override Approve records on its own (#1903). A confirmed gap blocks twice: as a
 * finding and as the final check's word-match miss. Once the candidate settles every confirmed
 * gap with a reason (marking them as known, an override, or a rejection) and no other final
 * check fails, those reasons are the override, so no second "Approve with override" is needed.
 * Null when another blocker remains, a gap is unsettled, or nothing blocks.
 */
export function knownGapReadinessOverride(
  readiness: Pick<ApprovalReadiness, "applicationReady" | "blockers"> | null,
  findings: readonly ReviewFinding[],
): string | null {
  if (readiness === null || readiness.applicationReady || readiness.blockers.length === 0) {
    return null;
  }
  const onlyWordMatch = readiness.blockers.every(
    (blocker) =>
      blocker.code === "deterministic-error" && blocker.check === WORD_MATCH_COVERAGE_CODE,
  );
  const gaps = findings.filter(isConfirmedCoverageGap);
  if (!onlyWordMatch || gaps.length === 0) return null;
  if (gaps.some((gap) => gap.decision !== "overridden" && gap.decision !== "rejected")) {
    return null;
  }
  const reasons = [
    ...new Set(gaps.map((gap) => gap.rationale?.trim() || KNOWN_GAP_RATIONALE)),
  ].join("; ");
  const rationale =
    gaps.length === 1 ? reasons : `${gaps.length} known gaps settled in review: ${reasons}`;
  return rationale.length <= MAXIMUM_OVERRIDE_RATIONALE_LENGTH
    ? rationale
    : `${rationale.slice(0, MAXIMUM_OVERRIDE_RATIONALE_LENGTH - 1)}…`;
}
