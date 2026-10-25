import {
  canonicalCandidateProfileDerivationApprovalErrorMessage,
  canonicalCandidateProfileDerivationErrorMessage,
  canonicalCandidateProfileSelectionStaleErrorMessage,
} from "./candidate-profile-derivation.js";

// Fixed, path-free application messages a user can act on. Only these exact
// strings may reach a person; any other derivation failure stays generic.
// The derivation service throws the first three as plain errors, and the
// workspace layer throws the last as a user error, so the message identifies
// them, not the error class. Profile size limits are not thrown: the
// application records them as a failed profile version with a clear cause.
const userFixableProfileDerivationMessages: ReadonlySet<string> = new Set([
  canonicalCandidateProfileDerivationApprovalErrorMessage,
  canonicalCandidateProfileDerivationErrorMessage,
  canonicalCandidateProfileSelectionStaleErrorMessage,
  "The configured candidate knowledge selection is no longer valid.",
]);

/**
 * Returns the user-facing message for a known, user-fixable profile derivation
 * failure, or `undefined` when the error must stay behind a generic message.
 * The desktop host and the hosted worker both use it.
 */
export function userFixableProfileDerivationMessage(error: unknown): string | undefined {
  if (!(error instanceof Error) || !userFixableProfileDerivationMessages.has(error.message)) {
    return undefined;
  }
  return error.message;
}
