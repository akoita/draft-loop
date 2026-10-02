import { anthropicBillingLimitDiagnosticCode, ProviderAdapterError } from "@draft-loop/providers";
import { describe, expect, it } from "vitest";

import {
  type CanonicalCandidateProfileExtractionInput,
  processCanonicalCandidateProfileExtraction,
} from "./candidate-profile-extraction.js";
import { candidateProfileExtractionFailureMessage } from "./candidate-profile-extraction-errors.js";

const billingMessage =
  "Anthropic API credits or the configured spending limit prevented this request. Check billing or the spending limit, then retry after resolving it.";

function source(): CanonicalCandidateProfileExtractionInput["sources"][number] {
  return {
    id: "source-opaque",
    mediaType: "text/markdown",
    checksum: "a".repeat(64),
    text: "Candidate-provided career history.",
    reference: {
      storeId: "store-opaque",
      knowledgeBaseId: "knowledge-opaque",
      sourceId: "source-record-opaque",
      versionId: "version-opaque",
      kind: "candidate-provided",
    },
  };
}

describe("candidate profile extraction failure guidance", () => {
  it("shows the fixed Anthropic billing reason in a saved omission issue", async () => {
    const material = source();
    const result = await processCanonicalCandidateProfileExtraction(
      {
        extract: async () => {
          throw new ProviderAdapterError(
            "anthropic",
            "quota-exhausted",
            "private provider response details",
            {
              retryable: false,
              diagnostics: [{ code: anthropicBillingLimitDiagnosticCode, path: "error" }],
            },
          );
        },
      },
      {
        operationId: "billing-guidance-test",
        sources: [material],
        allowProviderData: true,
      },
    );

    expect(result.facts).toEqual([]);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({ severity: "error", message: billingMessage });
    expect(result.issues[0]?.sourceRefs).toContainEqual(material.reference);
    expect(JSON.stringify(result)).not.toContain("private provider response details");
  });

  it.each([
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
  ])("maps the allowlisted DeepInfra diagnostic %s to fixed guidance", (code, message) => {
    const error = new ProviderAdapterError(
      "deepinfra",
      "invalid-response",
      "raw response includes private source text and key=secret",
      {
        diagnostics: [{ code, path: "candidate.secret/path" }],
      },
    );

    const guidance = candidateProfileExtractionFailureMessage(error, "provider");

    expect(guidance).toBe(message);
    expect(guidance).not.toContain("private source text");
    expect(guidance).not.toContain("secret");
  });

  it("uses sanitized fallback guidance for unrecognized DeepInfra diagnostics", () => {
    const guidance = candidateProfileExtractionFailureMessage(
      new ProviderAdapterError("deepinfra", "invalid-response", "private response detail", {
        diagnostics: [{ code: "unknown_private_code", path: "private/path" }],
      }),
      "provider",
    );

    expect(guidance).toBe(
      "The provider returned an invalid extraction response. Retry or check the configured model.",
    );
    expect(guidance).not.toContain("private");
  });

  it("does not apply DeepInfra guidance to other providers", () => {
    const guidance = candidateProfileExtractionFailureMessage(
      new ProviderAdapterError("openai", "invalid-response", "private details", {
        diagnostics: [{ code: "malformed_stream", path: "private/path" }],
      }),
      "provider",
    );

    expect(guidance).toBe(
      "The provider returned an invalid extraction response. Retry or check the configured model.",
    );
  });

  it("does not let stream diagnostics override other DeepInfra error codes", () => {
    const guidance = candidateProfileExtractionFailureMessage(
      new ProviderAdapterError("deepinfra", "authentication", "private details", {
        diagnostics: [{ code: "malformed_stream", path: "private/path" }],
      }),
      "provider",
    );

    expect(guidance).toBe(
      "Provider authentication failed. Sign in or configure an API key, then retry.",
    );
  });

  it("uses billing guidance only for the fixed Anthropic billing diagnostic", () => {
    expect(
      candidateProfileExtractionFailureMessage(
        new ProviderAdapterError("anthropic", "quota-exhausted", "private"),
        "provider",
      ),
    ).toBe(
      "The provider rate limit or quota was reached. Check the account limit and retry later.",
    );
    expect(
      candidateProfileExtractionFailureMessage(
        new ProviderAdapterError("openai", "quota-exhausted", "private", {
          diagnostics: [{ code: anthropicBillingLimitDiagnosticCode, path: "error" }],
        }),
        "provider",
      ),
    ).toBe(
      "The provider rate limit or quota was reached. Check the account limit and retry later.",
    );
  });
});
