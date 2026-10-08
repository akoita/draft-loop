import {
  maximumCanonicalCandidateProfileFactCount,
  maximumCanonicalCandidateProfileIssueCount,
} from "@draft-loop/domain";

import { CandidateProfileProposalValidationError } from "./candidate-profile-proposal-validation.js";

/** The profile limit a derivation would exceed. */
export type CandidateProfileCapacityLimit = "facts" | "issues";

function formatLimit(count: number): string {
  return count.toLocaleString("en-US");
}

/** Content-free recorded cause for a derivation that would exceed a profile limit. */
export function candidateProfileCapacityFailureMessage(
  limit: CandidateProfileCapacityLimit,
): string {
  return limit === "facts"
    ? `The profile would have more than ${formatLimit(maximumCanonicalCandidateProfileFactCount)} facts. Remove or split sources and try again.`
    : `The profile would have more than ${formatLimit(maximumCanonicalCandidateProfileIssueCount)} review issues. Remove or split sources and try again.`;
}

/** The exceeded limit when an error reports a profile capacity overflow; otherwise `undefined`. */
export function candidateProfileCapacityLimitOf(
  error: unknown,
): CandidateProfileCapacityLimit | undefined {
  if (!(error instanceof CandidateProfileProposalValidationError)) return undefined;
  const codes = new Set(error.diagnosticCounts.map(({ code }) => code));
  if (codes.has("profile_too_many_facts")) return "facts";
  if (codes.has("profile_too_many_issues")) return "issues";
  return undefined;
}
