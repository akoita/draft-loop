import {
  CliUserError,
  canonicalCandidateProfileDerivationApprovalErrorMessage,
  canonicalCandidateProfileDerivationErrorMessage,
  canonicalCandidateProfileSelectionStaleErrorMessage,
} from "@draft-loop/application";

// Fixed, path-free application messages a user can act on. Only these exact
// strings may cross the bridge; any other derivation failure stays generic.
const userFixableProfileDerivationMessages: ReadonlySet<string> = new Set([
  canonicalCandidateProfileDerivationApprovalErrorMessage,
  canonicalCandidateProfileDerivationErrorMessage,
  canonicalCandidateProfileSelectionStaleErrorMessage,
]);

/**
 * Returns the user-facing message for a known, user-fixable profile derivation
 * failure, or `undefined` when the error must stay behind the generic bridge
 * message.
 */
export function userFixableProfileDerivationMessage(error: unknown): string | undefined {
  const isUserError =
    error instanceof CliUserError || (error instanceof Error && error.name === "CliUserError");
  if (!isUserError || !userFixableProfileDerivationMessages.has(error.message)) {
    return undefined;
  }
  return error.message;
}
