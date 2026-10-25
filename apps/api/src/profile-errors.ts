import {
  canonicalCandidateProfileIdentityErrorMessage,
  canonicalCandidateProfileNotFoundErrorMessage,
  canonicalCandidateProfilePatchErrorMessage,
  canonicalCandidateProfileTimestampErrorMessage,
  canonicalCandidateProfileVersionStaleErrorMessage,
} from "@draft-loop/application";

/** The deployment has no queue to derive profiles on. */
export class ProfileDerivationUnavailableError extends Error {
  override readonly name = "ProfileDerivationUnavailableError";
  constructor() {
    super("Career profiles cannot be derived on this deployment.");
  }
}

/** An edit or review the profile's rules refuse, such as a review while issues are open. */
export class ProfileRuleError extends Error {
  override readonly name = "ProfileRuleError";
}

/**
 * Turns the domain's rule refusals of a profile edit or review into a 422. The domain words each
 * rule for a person, by field and never by value, so the rules are safe to answer with.
 */
export async function refusingProfileRules<Result>(work: Promise<Result>): Promise<Result> {
  try {
    return await work;
  } catch (error) {
    const issues = (error as { issues?: unknown }).issues;
    if (
      error instanceof Error &&
      error.name === "SemanticValidationError" &&
      Array.isArray(issues)
    ) {
      const rules = issues
        .map((issue) => (issue as { message?: unknown }).message)
        .filter((message): message is string => typeof message === "string");
      throw new ProfileRuleError(`The career profile breaks a rule: ${rules.join(" ")}`, {
        cause: error,
      });
    }
    throw error;
  }
}

/** A refusal's status, code and the message the API answers with. */
export interface ProfileRefusal {
  readonly status: number;
  readonly code: string;
  readonly message: string;
}

/**
 * The profile service's fixed refusals, by message as the desktop matches them: none quotes
 * profile content, so each is safe to answer with.
 */
const refusals: ReadonlyMap<string, ProfileRefusal> = new Map([
  [
    canonicalCandidateProfileNotFoundErrorMessage,
    { status: 404, code: "not_found", message: "No such career profile." },
  ],
  [
    canonicalCandidateProfileVersionStaleErrorMessage,
    {
      status: 409,
      code: "profile_version_stale",
      message: "The career profile has a newer version; reload it.",
    },
  ],
  [
    "Only a draft canonical candidate profile can be reviewed.",
    {
      status: 409,
      code: "profile_not_draft",
      message: "Only a draft career profile can be reviewed.",
    },
  ],
  ...[
    canonicalCandidateProfilePatchErrorMessage,
    canonicalCandidateProfileTimestampErrorMessage,
    canonicalCandidateProfileIdentityErrorMessage,
  ].map((message) => [message, { status: 422, code: "rejected", message }] as const),
]);

/** How the API answers a profile refusal; undefined for any other error. */
export function profileRefusal(error: Error): ProfileRefusal | undefined {
  if (error instanceof ProfileRuleError) {
    return { status: 422, code: "profile_rule", message: error.message };
  }
  if (error instanceof ProfileDerivationUnavailableError) {
    return { status: 503, code: "derivation_unavailable", message: error.message };
  }
  return refusals.get(error.message);
}
