/**
 * The final CV checks' blockers grouped for reading. A run with six word-match misses records six
 * identical "deterministic-error" blockers; listing each one turned the approval panel into a wall
 * of the same sentence. Identical blockers are counted once, each group naming its check.
 */

import {
  type ApprovalReadinessBlocker,
  approvalReadinessCheckLabels,
  formatApprovalReadinessBlocker,
} from "./approval-readiness.js";

export interface ReadinessBlockerGroup {
  readonly blocker: ApprovalReadinessBlocker;
  readonly count: number;
}

function groupKey(blocker: ApprovalReadinessBlocker): string {
  return [blocker.code, blocker.check ?? "", blocker.dimension ?? ""].join("|");
}

/** Identical blockers counted together, in the order each first appears. */
export function groupReadinessBlockers(
  blockers: readonly ApprovalReadinessBlocker[],
): readonly ReadinessBlockerGroup[] {
  const groups = new Map<string, { blocker: ApprovalReadinessBlocker; count: number }>();
  for (const blocker of blockers) {
    const key = groupKey(blocker);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, { blocker, count: 1 });
    else group.count += 1;
  }
  return [...groups.values()];
}

/**
 * One group in words: a single blocker as before, several as a count that names the check, e.g.
 * "6 validation checks failed: requirement wording not found in the draft (word match)".
 */
export function formatReadinessBlockerGroup(group: ReadinessBlockerGroup): string {
  const { blocker, count } = group;
  if (count === 1) return formatApprovalReadinessBlocker(blocker);
  switch (blocker.code) {
    case "deterministic-error":
      return blocker.check === undefined
        ? `${count} validation checks failed`
        : `${count} validation checks failed: ${approvalReadinessCheckLabels[blocker.check]}`;
    case "report-error":
      return blocker.dimension === undefined
        ? `${count} readiness report findings block readiness`
        : `${count} readiness report findings on ${blocker.dimension} block readiness`;
    case "incomplete-report-inputs":
      return `${count} readiness report inputs are missing`;
    case "missing-revision-effect":
      return `${count} required revision effects are missing`;
    default:
      return `${formatApprovalReadinessBlocker(blocker)} (${count} times)`;
  }
}

/** Every blocker in words, identical ones grouped: "6 validation checks failed: …; 6 …". */
export function formatReadinessBlockers(blockers: readonly ApprovalReadinessBlocker[]): string[] {
  return groupReadinessBlockers(blockers).map(formatReadinessBlockerGroup);
}
