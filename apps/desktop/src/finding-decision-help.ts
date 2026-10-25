import type { FindingDecision, ReviewFinding } from "@draft-loop/ui/model";

/** The four decisions a person can record on a finding. */
export type ExplainedFindingDecision = Exclude<FindingDecision, "pending">;

export interface FindingDecisionContext {
  /** Whether the run can still request another revision of this draft. */
  readonly revisionAvailable: boolean;
}

/** The finding code the deterministic, word-match coverage check reports. */
export const WORD_MATCH_COVERAGE_CODE = "uncovered-requirement";

export const ACCEPT_UNAVAILABLE_NOTE = "No revision left: use Reject or Override";

export const ACCEPTED_WITHOUT_REVISION_NUDGE =
  "Accepted, but no revision is left: change to Reject or Override to unblock approval";

export const COVERAGE_INFORMATION_NOTE = "Coverage verdicts inform you; they never block approval.";

export const BULK_ACCEPT_SKIPS_WORD_MATCH_NOTE = "Accept all skips word-match warnings";

/**
 * One plain line per decision saying what it does to the next revision and to
 * approval. Blocking findings stay unresolved when accepted or deferred; only
 * a revision, a rejection, or a reasoned override clears them.
 */
export function findingDecisionEffects(
  finding: Pick<ReviewFinding, "severity">,
  { revisionAvailable }: FindingDecisionContext,
): Readonly<Record<ExplainedFindingDecision, string>> {
  if (finding.severity === "error") {
    return {
      accepted: revisionAvailable
        ? "the next revision fixes it; approval stays locked until then"
        : "no revision left, so approval stays locked",
      rejected: "the finding is wrong; unblocks approval",
      overridden: "keep the draft as is, with a reason; unblocks approval",
      deferred: "decide later; still blocks approval",
    };
  }
  return {
    accepted: revisionAvailable
      ? "the next revision fixes it; warnings never block approval"
      : "no revision left to fix it; warnings never block approval",
    rejected: "the finding is wrong; the next revision leaves it alone",
    overridden: "keep the draft as is, with a reason; the next revision leaves it alone",
    deferred: "decide later; warnings never block approval",
  };
}

/** Accepting a blocking finding is a dead end when no revision can fix it. */
export function acceptUnavailable(
  finding: Pick<ReviewFinding, "severity">,
  { revisionAvailable }: FindingDecisionContext,
): boolean {
  return finding.severity === "error" && !revisionAvailable;
}

/** An accepted blocking finding that no revision can now resolve. */
export function acceptedWithoutRevision(
  finding: Pick<ReviewFinding, "severity" | "decision">,
  context: FindingDecisionContext,
): boolean {
  return finding.decision === "accepted" && acceptUnavailable(finding, context);
}

export function isWordMatchCoverageWarning(finding: Pick<ReviewFinding, "code">): boolean {
  return finding.code === WORD_MATCH_COVERAGE_CODE;
}

/**
 * Bulk Accept skips word-match coverage warnings: accepting them in bulk asks
 * the author to stuff the job's wording into the draft. With no revision left
 * it also skips blocking findings, which an Accept could never resolve. Other
 * decisions are applied to every target unchanged.
 */
export function bulkDecisionTargetsForDecision(
  findings: readonly ReviewFinding[],
  targetIds: readonly string[],
  decision: Exclude<FindingDecision, "pending" | "overridden">,
  context: FindingDecisionContext,
): readonly string[] {
  if (decision !== "accepted") return targetIds;
  const skipped = new Set(
    findings
      .filter(
        (finding) => isWordMatchCoverageWarning(finding) || acceptUnavailable(finding, context),
      )
      .map((finding) => finding.id),
  );
  return targetIds.filter((id) => !skipped.has(id));
}

export const BULK_ACCEPT_SKIPS_BLOCKING_NOTE =
  "No revision left: Accept all skips blocking findings; use Reject or Override for them.";

/** The bulk bar's line when Accept all skips blocking findings, or null when it does not. */
export function bulkBlockingSkipNote(
  shown: readonly ReviewFinding[],
  context: FindingDecisionContext,
): string | null {
  return shown.some((finding) => acceptUnavailable(finding, context))
    ? BULK_ACCEPT_SKIPS_BLOCKING_NOTE
    : null;
}

/** The bulk bar's warning, or null when the shown set has no word-match warnings. */
export function bulkWordMatchWarning(shown: readonly ReviewFinding[]): string | null {
  const count = shown.filter(isWordMatchCoverageWarning).length;
  if (count === 0) return null;
  return `Includes ${count} word-match coverage warning${count === 1 ? "" : "s"}; accepting them asks the author to add the job's wording.`;
}
