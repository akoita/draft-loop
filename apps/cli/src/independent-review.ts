import type { IndependentReviewRecord } from "./workflow.js";

/**
 * The verdict line for a recorded claim.
 *
 * A lineage is an operator label, never a measurement: nothing in the system
 * can tell whether two labels name the same weights (ADR 0005). No branch here
 * may therefore read as though independence was proven; the distinct case says
 * what was claimed and immediately says what that claim is worth.
 */
function independenceVerdict(record: IndependentReviewRecord): string {
  if (!record.required) {
    return `Independent review: not required for this run; the claimed lineages ${
      record.lineagesDistinct ? "differ" : "are the same"
    }.`;
  }
  if (record.lineagesDistinct) {
    return "Independent review: lineages differ, as claimed. A lineage is an operator label that nothing verifies; two labels can name the same weights.";
  }
  if (record.overrideRationale !== undefined) {
    return "Independent review: overridden. Author and critic share one lineage, so this critique was not independent; the run proceeded on a recorded rationale.";
  }
  return "Independent review: not independent. Author and critic share one lineage, and no override rationale was recorded.";
}

/**
 * What independence a run recorded, as local status lines.
 *
 * An absent record is an honest state rather than a failure: a workspace with
 * no run, and a run configured before independence was recorded, both have
 * nothing to report and must still print a status.
 *
 * The override rationale is operator prose. It is written to the local
 * terminal only; nothing here is ever sent to a provider.
 */
export function independentReviewLines(
  record: IndependentReviewRecord | undefined,
): readonly string[] {
  if (record === undefined) {
    return [
      "Independent review: no lineage claim was recorded. Either no run has started yet, or the run predates independence being recorded.",
    ];
  }
  return [
    `Claimed lineages: author ${record.authorLineage}; critic ${record.criticLineage}`,
    independenceVerdict(record),
    ...(record.overrideRationale === undefined
      ? []
      : [`Override rationale: ${record.overrideRationale}`]),
  ];
}
