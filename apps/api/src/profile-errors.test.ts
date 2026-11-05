import {
  canonicalCandidateProfileIdentityErrorMessage,
  canonicalCandidateProfileNotFoundErrorMessage,
  canonicalCandidateProfilePatchErrorMessage,
  canonicalCandidateProfileTimestampErrorMessage,
  canonicalCandidateProfileVersionStaleErrorMessage,
} from "@draft-loop/application";
import { describe, expect, it } from "vitest";

import {
  ProfileDerivationUnavailableError,
  ProfileRuleError,
  profileRefusal,
  refusingProfileRules,
} from "./profile-errors.js";

/** A domain rule refusal, shaped as the domain's `SemanticValidationError`. */
function semanticError(issues: unknown): Error {
  const error = new Error("The profile is invalid.") as Error & { issues: unknown };
  error.name = "SemanticValidationError";
  error.issues = issues;
  return error;
}

describe("refusingProfileRules", () => {
  it("passes the work's result through", async () => {
    await expect(refusingProfileRules(Promise.resolve("profile-1"))).resolves.toBe("profile-1");
  });

  it("turns the domain's rule refusals into one rule error, keeping only worded rules", async () => {
    const cause = semanticError([
      { message: "A review needs every issue resolved." },
      { message: "A skill needs a source." },
      { message: 42 },
      { path: "/skills" },
    ]);

    const refused = await refusingProfileRules(Promise.reject(cause)).catch((error) => error);

    expect(refused).toBeInstanceOf(ProfileRuleError);
    expect(refused.message).toBe(
      "The career profile breaks a rule: A review needs every issue resolved. A skill needs a source.",
    );
    expect(refused.cause).toBe(cause);
  });

  it("rethrows any other error unchanged", async () => {
    const other = new Error("Storage unavailable.");
    const noIssues = semanticError("not a list");
    const lookalike = { name: "SemanticValidationError", issues: [] };

    await expect(refusingProfileRules(Promise.reject(other))).rejects.toBe(other);
    await expect(refusingProfileRules(Promise.reject(noIssues))).rejects.toBe(noIssues);
    await expect(refusingProfileRules(Promise.reject(lookalike))).rejects.toBe(lookalike);
  });
});

describe("profileRefusal", () => {
  it("answers a rule error with 422 and its rules", () => {
    expect(profileRefusal(new ProfileRuleError("The career profile breaks a rule: X."))).toEqual({
      status: 422,
      code: "profile_rule",
      message: "The career profile breaks a rule: X.",
    });
  });

  it("answers a deployment without a derivation queue with 503", () => {
    expect(profileRefusal(new ProfileDerivationUnavailableError())).toEqual({
      status: 503,
      code: "derivation_unavailable",
      message: "Career profiles cannot be derived on this deployment.",
    });
  });

  it("maps the profile service's fixed refusals by message", () => {
    expect(profileRefusal(new Error(canonicalCandidateProfileNotFoundErrorMessage))).toEqual({
      status: 404,
      code: "not_found",
      message: "No such career profile.",
    });
    expect(profileRefusal(new Error(canonicalCandidateProfileVersionStaleErrorMessage))).toEqual({
      status: 409,
      code: "profile_version_stale",
      message: "The career profile has a newer version; reload it.",
    });
    expect(
      profileRefusal(new Error("Only a draft canonical candidate profile can be reviewed.")),
    ).toEqual({
      status: 409,
      code: "profile_not_draft",
      message: "Only a draft career profile can be reviewed.",
    });
    for (const message of [
      canonicalCandidateProfilePatchErrorMessage,
      canonicalCandidateProfileTimestampErrorMessage,
      canonicalCandidateProfileIdentityErrorMessage,
    ]) {
      expect(profileRefusal(new Error(message))).toEqual({
        status: 422,
        code: "rejected",
        message,
      });
    }
  });

  it("leaves any other error to the caller", () => {
    expect(profileRefusal(new Error("Storage unavailable."))).toBeUndefined();
  });
});
