import { anthropicBillingLimitDiagnosticCode, ProviderAdapterError } from "@draft-loop/providers";

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

const deepInfraDiagnosticMessages = new Map<string, string>([
  [
    "malformed_stream",
    "DeepInfra returned a malformed GLM stream. Check provider/model compatibility and update DraftLoop to the latest supported version; no facts were saved.",
  ],
  [
    "incomplete_stream",
    "DeepInfra ended the GLM stream before completing the profile. Check provider status or the network connection, or choose another supported model; no facts were saved.",
  ],
  [
    "incomplete_response",
    "DeepInfra ended the structured response before completing the profile. Check provider status or the network connection, or choose another supported model; no facts were saved.",
  ],
  [
    "invalid_json",
    "DeepInfra did not return valid structured JSON. Check the selected model's structured-output support or choose another supported model; no facts were saved.",
  ],
  [
    "missing_output",
    "DeepInfra returned no structured profile output. Check the selected model's structured-output support or choose another supported model; no facts were saved.",
  ],
  [
    "unexpected_response_model",
    "DeepInfra returned a response for an unexpected GLM model. Verify the configured model and endpoint; no facts were saved.",
  ],
]);

function deepInfraFailureMessage(error: ProviderAdapterError): string | undefined {
  if (error.provider !== "deepinfra" || error.code !== "invalid-response") return undefined;
  for (const diagnostic of [...error.diagnostics, ...error.diagnosticCounts]) {
    const message = deepInfraDiagnosticMessages.get(diagnostic.code);
    if (message !== undefined) return message;
  }
  return undefined;
}

function providerFailureMessage(error: ProviderAdapterError): string {
  const deepInfraMessage = deepInfraFailureMessage(error);
  if (deepInfraMessage !== undefined) return deepInfraMessage;
  if (
    error.provider === "anthropic" &&
    error.code === "quota-exhausted" &&
    error.diagnostics.some((diagnostic) => diagnostic.code === anthropicBillingLimitDiagnosticCode)
  ) {
    return "Anthropic API credits or the configured spending limit prevented this request. Check billing or the spending limit, then retry after resolving it.";
  }
  if (error.code === "invalid-response" && error.failureStage === "response-schema-validation") {
    return stageFailureMessages["response-schema"];
  }
  if (
    error.failureStage === "output-token-budget-exceeded" ||
    (error.code === "invalid-response" &&
      (error.diagnostics.some((diagnostic) => diagnostic.code === "max_tokens") ||
        error.diagnosticCounts.some((diagnostic) => diagnostic.code === "max_tokens")))
  ) {
    return "Profile extraction exceeded the available output limit. No facts were saved; try fewer or shorter sources, or use a supported model with a larger output allowance.";
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
