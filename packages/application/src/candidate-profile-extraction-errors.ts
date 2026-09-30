import { ProviderAdapterError } from "@draft-loop/providers";

export type CandidateProfileExtractionStage =
  | "input-preparation"
  | "provider"
  | "response-schema"
  | "grounding";

const stageFailureMessages: Record<Exclude<CandidateProfileExtractionStage, "provider">, string> = {
  "input-preparation":
    "Candidate profile source material could not be prepared. Check the selected source references and try again.",
  "response-schema":
    "The provider response did not match the required candidate profile format. Retry or check the configured model.",
  grounding:
    "Extracted claims could not be grounded in the selected sources. No facts were saved; review the source material and try again.",
};

function providerFailureMessage(error: ProviderAdapterError): string {
  if (error.failureStage === "output-token-budget-exceeded") {
    return "The provider response exceeded the profile extraction output limit. Report this error before retrying.";
  }

  switch (error.code) {
    case "authentication":
      return "Provider authentication failed. Sign in or configure an API key, then retry.";
    case "permission":
      return "The provider denied access to the extraction request. Check account permissions and access to the selected model.";
    case "rate-limit":
    case "quota-exhausted":
      return "The provider rate limit or quota was reached. Check the account limit and retry later.";
    case "timeout":
    case "transient":
      return "The provider request timed out or failed temporarily. Retry in a moment.";
    case "cancelled":
      return "The provider cancelled candidate profile extraction. Retry if you still need this profile.";
    case "invalid-request":
      return "The provider rejected the extraction request. Check the model configuration and retry.";
    case "invalid-response":
      return "The provider returned an invalid extraction response. Retry or check the configured model.";
    case "policy":
      return "The provider did not accept this extraction request under its policy. Check provider settings.";
    case "unknown":
      return "The provider failed during candidate profile extraction for an unknown reason. Check the configured provider and retry.";
  }
}

/** Return fixed user guidance without exposing provider diagnostics or source content. */
export function candidateProfileExtractionFailureMessage(
  error: unknown,
  stage: CandidateProfileExtractionStage,
): string {
  if (stage === "provider" && error instanceof ProviderAdapterError) {
    return providerFailureMessage(error);
  }
  if (stage === "provider") {
    return "The provider failed during candidate profile extraction for an unknown reason. Check the configured provider and retry.";
  }
  return stageFailureMessages[stage];
}
