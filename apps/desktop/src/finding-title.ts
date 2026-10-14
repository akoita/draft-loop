import type { ReviewFinding } from "./model.js";

/**
 * Plain-words titles for coverage findings that name their requirement.
 * Every other finding, and a coverage finding without a resolved requirement,
 * keeps its message as its title.
 */
const requirementTitlePrefixes: Readonly<Record<string, string>> = {
  "uncovered-requirement": "Not found in the CV wording: ",
  "coverage-block-dropped": "A line covering this requirement was removed: ",
};

/** The title the review queue and margin notes show for a finding. */
export function findingTitle(
  finding: Pick<ReviewFinding, "code" | "message" | "requirement">,
): string {
  const prefix = Object.hasOwn(requirementTitlePrefixes, finding.code)
    ? requirementTitlePrefixes[finding.code]
    : undefined;
  const text = finding.requirement?.text;
  return prefix === undefined || text === undefined || text === ""
    ? finding.message
    : `${prefix}${text}`;
}
