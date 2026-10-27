/**
 * Coverage counted apart for a reviewed brief's requirements and its responsibilities.
 *
 * A run from a reviewed brief checks both, so coverage lists both, but relevance is scored on the
 * requirements alone. Counting them together ("2 of 13") reads as if the brief had 13
 * requirements and hides which number relevance comes from.
 */

import type { ReviewCoverageView } from "./coverage-contract.js";

export interface CoverageKindTally {
  readonly covered: number;
  readonly total: number;
}

export interface CoverageKindTallies {
  readonly requirements: CoverageKindTally;
  readonly responsibilities: CoverageKindTally;
}

/** The two tallies, or `null` when the run checked no responsibilities (or recorded no kinds). */
export function coverageKindTallies(coverage: ReviewCoverageView): CoverageKindTallies | null {
  const responsibilities = coverage.assessments.filter(
    (assessment) => assessment.kind === "responsibility",
  );
  if (responsibilities.length === 0) return null;
  const requirements = coverage.assessments.filter(
    (assessment) => assessment.kind !== "responsibility",
  );
  const tally = (assessments: ReviewCoverageView["assessments"]): CoverageKindTally => ({
    covered: assessments.filter((assessment) => assessment.status === "covered").length,
    total: assessments.length,
  });
  return { requirements: tally(requirements), responsibilities: tally(responsibilities) };
}

function plural(count: number, noun: string, nouns: string): string {
  return `${count} ${count === 1 ? noun : nouns}`;
}

/** "0 of 9 requirements covered · 2 of 4 responsibilities covered" */
export function coverageKindsSummary(tallies: CoverageKindTallies): string {
  const { requirements, responsibilities } = tallies;
  return `${requirements.covered} of ${plural(requirements.total, "requirement", "requirements")} covered · ${responsibilities.covered} of ${plural(responsibilities.total, "responsibility", "responsibilities")} covered`;
}

/** "over 9 requirements": what relevance is scored on, for a run that also checked responsibilities. */
export function relevanceScope(coverage: ReviewCoverageView | null | undefined): string | null {
  if (coverage === null || coverage === undefined) return null;
  const tallies = coverageKindTallies(coverage);
  return tallies === null
    ? null
    : `over ${plural(tallies.requirements.total, "requirement", "requirements")}, not the ${plural(tallies.responsibilities.total, "responsibility", "responsibilities")}`;
}
