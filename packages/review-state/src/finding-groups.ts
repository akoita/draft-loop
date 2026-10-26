import type { ReviewFinding } from "@draft-loop/ui/model";

import type { ReviewDecisions } from "./review-state.js";

/**
 * The review screen's findings, with the warnings one quality rule raised in several places shown
 * as one finding that lists those places (#1788). The run keeps every finding; the group takes its
 * first member's id, so a decision on it is recorded once, on that id.
 */
export function groupRepeatedWarnings(
  findings: readonly ReviewFinding[],
  sectionTitles: ReadonlyMap<string, string>,
  overrides: ReviewDecisions,
): readonly ReviewFinding[] {
  const groups = new Map<string, ReviewFinding[]>();
  for (const finding of findings) {
    const key = groupKey(finding);
    if (key === undefined) continue;
    groups.set(key, [...(groups.get(key) ?? []), finding]);
  }
  const grouped: ReviewFinding[] = [];
  for (const finding of findings) {
    const key = groupKey(finding);
    const members = key === undefined ? undefined : groups.get(key);
    if (members === undefined || members.length < 2) {
      grouped.push(finding);
    } else if (members[0] === finding) {
      grouped.push(groupedFinding(members, sectionTitles, overrides));
    }
  }
  return grouped;
}

/** Only quality warnings about the draft's wording group; a requirement's finding stays its own. */
function groupKey(finding: ReviewFinding): string | undefined {
  if (finding.severity !== "warning" || finding.category !== "quality") return undefined;
  if (finding.requirement !== undefined) return undefined;
  return finding.code;
}

function groupedFinding(
  members: readonly ReviewFinding[],
  sectionTitles: ReadonlyMap<string, string>,
  overrides: ReviewDecisions,
): ReviewFinding {
  const [first] = members as readonly [ReviewFinding, ...ReviewFinding[]];
  // A member decided before the findings were grouped still shows its decision on the group.
  const decided = members.find(({ id }) => overrides.decisions[id] !== undefined);
  const places = members.map(({ sectionId, message }) => {
    const title = sectionId === undefined ? undefined : sectionTitles.get(sectionId);
    const place = title === undefined ? message : `${title}: ${message}`;
    return /[.!?]$/u.test(place) ? place : `${place}.`;
  });
  const { rationale: _rationale, ...rest } = first;
  const rationale = decided === undefined ? undefined : overrides.rationales[decided.id];
  return {
    ...rest,
    message: `Found in ${members.length} places. ${places.join(" ")}`,
    decision: decided === undefined ? "pending" : (overrides.decisions[decided.id] ?? "pending"),
    ...(rationale === undefined ? {} : { rationale }),
  };
}
