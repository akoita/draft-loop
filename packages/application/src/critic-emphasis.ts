/**
 * The strategic emphasis review that `cli-critic-v5` adds: does the CV make the strongest case
 * for this job? The critic compares the job's central themes with what the draft leads with,
 * expands and compresses, and names one concrete move per finding.
 */

/** A central theme is in the job, supported by approved evidence, but the draft plays it down. */
export const emphasisThemeBuriedCode = "emphasis-theme-buried";
/** Draft space goes to content the job does not ask for. */
export const emphasisPaddingCode = "emphasis-padding";
/** Supported content that matters to the job sits too low or in the wrong place. */
export const emphasisOrderCode = "emphasis-order";
/** A central theme the approved evidence does not support: a gap to tell the candidate, not a move. */
export const emphasisThemeGapCode = "emphasis-theme-gap";

export const emphasisFindingCodes = [
  emphasisThemeBuriedCode,
  emphasisPaddingCode,
  emphasisOrderCode,
  emphasisThemeGapCode,
] as const;

const emphasisCodePrefix = "emphasis-";

/**
 * Hook for the application plan (#1304). Today the critic derives the job's central themes from
 * the requirements and responsibilities in context, weighted by priority and repetition. When an
 * approved application plan is sent to the critic, replace this sentence so the plan's themes
 * are used instead; the finding codes and severity rules below stay the same.
 */
export const emphasisThemeSourceInstructions =
  "Derive the job's central themes from context.requirements and the responsibilities in the job description, weighting them by priority and by how often the job repeats them.";

export const emphasisReviewInstructions =
  ` Also review the job emphasis: whether the CV makes the strongest case for this job. ${emphasisThemeSourceInstructions} Compare those themes with what the draft leads with in the summary and core areas, what it expands, and what it compresses or pads. Report each emphasis finding as category coverage with a message that names one concrete move and the job theme or requirement it serves, quoting the requirement id when one applies, and the retrievedEvidence ID that supports the move. Use code ${emphasisThemeBuriedCode} to expand a supported central theme or move it up into the summary or core areas; ${emphasisPaddingCode} to compress or drop content the job does not ask for (such as certifications that only pad); ${emphasisOrderCode} to move supported relevant content earlier or lead a role with it. Severity is warning by default. Use error only for ${emphasisThemeBuriedCode} when the job's top-priority theme is missing from the summary and core areas and retrievedEvidence clearly supports it, so the author can fix it. ` +
  `When the approved evidence does not support a central theme, do not ask for a move: report one ${emphasisThemeGapCode} warning that states the gap and the theme, and never ask for content the evidence lacks. Do not repeat editorial or coverage findings, and report at most 5 emphasis findings.`;

export function isEmphasisFindingCode(code: string): boolean {
  return code.startsWith(emphasisCodePrefix);
}

/**
 * Enforce the emphasis severity rule on a parsed finding. Only `emphasis-theme-buried` may block;
 * every other emphasis code is advice at most, and a gap never blocks because the author cannot
 * fix it. Findings with other codes are returned untouched.
 */
export function normalizeEmphasisSeverity<
  T extends { readonly code: string; readonly severity: string },
>(finding: T): T {
  if (
    isEmphasisFindingCode(finding.code) &&
    finding.code !== emphasisThemeBuriedCode &&
    finding.severity === "error"
  ) {
    return { ...finding, severity: "warning" };
  }
  return finding;
}
