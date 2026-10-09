import {
  maximumCanonicalCandidateProfileFactCount,
  maximumCanonicalCandidateProfileIssueCount,
  maximumCanonicalCandidateProfileValueLength,
} from "@draft-loop/domain";
import { anthropicBillingLimitDiagnosticCode, ProviderAdapterError } from "@draft-loop/providers";
import { CandidateProfileGroundingError } from "./candidate-profile-grounding-diagnostics.js";
import { CandidateProfileInputError } from "./candidate-profile-input-error.js";
import { CandidateProfileProposalValidationError } from "./candidate-profile-proposal-validation.js";
import { deepInfraProfileTransportFailureMessage } from "./candidate-profile-transport-guidance.js";

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

const maximumDisplayedDiagnosticCount = 1_000;
const schemaDiagnosticLabels = [
  ["profile_output_invalid_type", "invalid field types"],
  ["profile_output_too_big", "fields over the size limit"],
  ["profile_output_too_small", "missing or undersized fields"],
  ["profile_output_invalid_value", "invalid allowed values"],
  ["profile_output_unrecognized_keys", "unexpected fields"],
  ["profile_output_invalid_format", "invalid formats"],
  ["profile_output_invalid_union", "invalid alternatives"],
  ["profile_output_constraint", "other constraints"],
] as const;
const localProposalDiagnosticLabels = [
  ["profile_duplicate_evidence", "duplicate evidence citations"],
  ["profile_duplicate_fact_keys", "duplicate fact keys"],
  ["profile_duplicate_issue_facts", "duplicate issue references"],
  ["profile_unknown_issue_facts", "unknown issue fact references"],
  ["profile_duplicate_issue_sources", "duplicate issue source references"],
  ["profile_unpaired_conflicts", "conflicts without two distinct facts"],
  [
    "profile_fact_value_too_long",
    `fact values over ${maximumCanonicalCandidateProfileValueLength} characters`,
  ],
  [
    "profile_evidence_quote_too_long",
    `evidence quotes over ${maximumCanonicalCandidateProfileValueLength} characters`,
  ],
  ...schemaDiagnosticLabels,
] as const;
const groundingDiagnosticLabels = [
  ["unknown_source", "unknown cited sources"],
  ["quote_not_in_source", "quotes absent from cited source text"],
  ["value_not_in_quote", "values absent from evidence quotes"],
] as const;
const deepInfraStreamDiagnosticLabels = [
  ["stream_chunk_envelope", "invalid chunk envelope"],
  ["stream_chunk_identity", "inconsistent chunk identity"],
  ["stream_model_metadata", "invalid model metadata"],
  ["stream_timestamp_metadata", "invalid timestamp metadata"],
  ["stream_usage_sequence", "invalid usage sequence"],
  ["stream_post_terminal_data", "data after terminal marker"],
  ["stream_choice_count", "invalid choice count"],
  ["stream_choice_shape", "invalid choice shape"],
  ["stream_delta_type", "invalid delta type"],
  ["stream_choice_index", "invalid choice index"],
  ["stream_role", "invalid message role"],
  ["stream_tool_data", "unsupported tool data"],
  ["stream_content_type", "invalid content type"],
  ["stream_refusal_type", "invalid refusal type"],
  ["stream_finish_marker", "invalid finish marker"],
] as const;

function addBoundedCount(current: number, increment: number): number {
  return increment >= maximumDisplayedDiagnosticCount - current
    ? maximumDisplayedDiagnosticCount
    : current + increment;
}

function formatCount(count: number): string {
  return count >= maximumDisplayedDiagnosticCount ? "999+" : String(count);
}

function summarizeCounts(
  entries: readonly { readonly code: string; readonly count: number }[],
  labels: readonly (readonly [string, string])[],
  visibleReasonLimit = 2,
): string | undefined {
  const recognized = new Map<string, number>();
  for (const entry of entries) {
    if (!Number.isSafeInteger(entry.count) || entry.count <= 0) continue;
    if (!labels.some(([code]) => code === entry.code)) continue;
    recognized.set(entry.code, addBoundedCount(recognized.get(entry.code) ?? 0, entry.count));
  }
  const present = labels.flatMap(([code, label]) => {
    const count = recognized.get(code);
    return count === undefined ? [] : [{ label, count }];
  });
  if (present.length === 0) return undefined;

  const shown = present
    .slice(0, visibleReasonLimit)
    .map(({ label, count }) => `${label}: ${formatCount(count)}`);
  const remaining = present
    .slice(visibleReasonLimit)
    .reduce((sum, entry) => addBoundedCount(sum, entry.count), 0);
  if (remaining > 0) shown.push(`${formatCount(remaining)} other issues`);
  return shown.join("; ");
}

function deepInfraOutputSchemaFailureMessage(error: unknown): string | undefined {
  if (
    !(error instanceof ProviderAdapterError) ||
    error.provider !== "deepinfra" ||
    error.code !== "invalid-response" ||
    error.failureStage !== "response-schema-validation" ||
    !error.diagnostics.some((diagnostic) => diagnostic.code === "output_schema_mismatch")
  ) {
    return undefined;
  }
  const summary = summarizeCounts(error.diagnosticCounts, schemaDiagnosticLabels);
  if (summary === undefined) return undefined;
  return `DeepInfra profile format is invalid. No facts were saved. Renaming will not help; check model support before retrying. Reasons: ${summary}.`;
}

function profileCapacityFailureMessage(
  diagnosticCounts: readonly { readonly code: string; readonly count: number }[],
): string | undefined {
  const codes = new Set(diagnosticCounts.filter(({ count }) => count > 0).map(({ code }) => code));
  if (codes.has("profile_too_many_facts")) {
    return `The selected sources produced more facts than one profile can hold (${maximumCanonicalCandidateProfileFactCount}). No facts were saved. Select fewer or smaller sources, then retry.`;
  }
  if (codes.has("profile_too_many_issues")) {
    return `The selected sources produced more review issues than one profile can hold (${maximumCanonicalCandidateProfileIssueCount}). No facts were saved. Select fewer or smaller sources, then retry.`;
  }
  return undefined;
}

function localProposalFailureMessage(
  error: CandidateProfileProposalValidationError | ProviderAdapterError,
): string | undefined {
  if (
    error instanceof ProviderAdapterError &&
    (error.code !== "invalid-response" ||
      error.failureStage !== "response-schema-validation" ||
      !error.diagnostics.some(
        (diagnostic) => diagnostic.code === "invalid_profile_extraction_batch",
      ))
  ) {
    return undefined;
  }
  const capacityMessage = profileCapacityFailureMessage(error.diagnosticCounts);
  if (capacityMessage !== undefined) return capacityMessage;
  const summary = summarizeCounts(error.diagnosticCounts, localProposalDiagnosticLabels);
  if (summary === undefined) return undefined;
  return `Profile output failed local validation. No facts were saved. Renaming will not help; check model support. Reasons: ${summary}.`;
}

function groundingFailureMessage(error: CandidateProfileGroundingError): string | undefined {
  const summary = summarizeCounts(error.diagnosticCounts, groundingDiagnosticLabels, 3);
  if (summary === undefined) return undefined;
  return `Claims could not be grounded. No facts were saved. Evidence failures: ${summary}. Check model support before retrying.`;
}

function deepInfraFailureMessage(error: ProviderAdapterError): string | undefined {
  if (error.provider !== "deepinfra" || error.code !== "invalid-response") return undefined;
  if (
    error.failureStage === "transport-parsing" &&
    error.diagnostics.some((diagnostic) => diagnostic.code === "malformed_stream")
  ) {
    const summary = summarizeCounts(error.diagnosticCounts, deepInfraStreamDiagnosticLabels);
    const base =
      "DeepInfra returned a malformed GLM stream. Check provider or model compatibility and update DraftLoop; no facts were saved.";
    return summary === undefined ? base : `${base} Reasons: ${summary}.`;
  }
  for (const diagnostic of [...error.diagnostics, ...error.diagnosticCounts]) {
    const message = deepInfraDiagnosticMessages.get(diagnostic.code);
    if (message !== undefined) return message;
  }
  return undefined;
}

const safeReasonCodePattern = /^[a-z][a-z0-9_]{0,63}$/u;

/** Name the adapter's fixed diagnostic code; provider text and content are never used. */
function invalidResponseReasonSuffix(error: ProviderAdapterError): string {
  const first = error.diagnostics[0]?.code;
  if (first === undefined || !safeReasonCodePattern.test(first)) return "";
  if (first === "malformed_stream") {
    const specific = error.diagnosticCounts.find(({ code }) => safeReasonCodePattern.test(code));
    if (specific !== undefined) return ` Reason: ${specific.code}.`;
  }
  return ` Reason: ${first}.`;
}

function providerFailureMessage(error: ProviderAdapterError): string {
  const transportMessage = deepInfraProfileTransportFailureMessage(error);
  if (transportMessage !== undefined) return transportMessage;
  const schemaMessage = deepInfraOutputSchemaFailureMessage(error);
  if (schemaMessage !== undefined) return schemaMessage;
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
      return `The provider returned an invalid extraction response. Retry or check the configured model.${invalidResponseReasonSuffix(error)}`;
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
  if (
    error instanceof CandidateProfileProposalValidationError ||
    ((stage === "provider" || stage === "response-schema") &&
      error instanceof ProviderAdapterError &&
      error.diagnostics.some(
        (diagnostic) => diagnostic.code === "invalid_profile_extraction_batch",
      ))
  ) {
    const localMessage = localProposalFailureMessage(error);
    if (localMessage !== undefined) return localMessage;
  }
  if (stage === "provider" && error instanceof ProviderAdapterError) {
    return providerFailureMessage(error);
  }
  if (stage === "provider") {
    return "The provider failed during candidate profile extraction for an unknown reason. Check the configured provider and retry.";
  }
  if (stage === "response-schema") {
    return deepInfraOutputSchemaFailureMessage(error) ?? stageFailureMessages[stage];
  }
  if (stage === "grounding" && error instanceof CandidateProfileGroundingError) {
    return groundingFailureMessage(error) ?? stageFailureMessages[stage];
  }
  if (stage === "input-preparation" && error instanceof CandidateProfileInputError) {
    return error.userMessage;
  }
  return stageFailureMessages[stage];
}
