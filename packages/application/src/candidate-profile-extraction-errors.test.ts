import { anthropicBillingLimitDiagnosticCode, ProviderAdapterError } from "@draft-loop/providers";
import { describe, expect, it } from "vitest";

import {
  type CanonicalCandidateProfileExtractionInput,
  processCanonicalCandidateProfileExtraction,
} from "./candidate-profile-extraction.js";
import { candidateProfileExtractionFailureMessage } from "./candidate-profile-extraction-errors.js";
import { CandidateProfileGroundingError } from "./candidate-profile-grounding-diagnostics.js";

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

  it("summarizes only bounded allowlisted DeepInfra schema counts", () => {
    const error = new ProviderAdapterError(
      "deepinfra",
      "invalid-response",
      "private output and provider text",
      {
        failureStage: "response-schema-validation",
        diagnostics: [{ code: "output_schema_mismatch", path: "private/candidate/path" }],
        diagnosticCounts: [
          { code: "profile_output_invalid_type", count: 2 },
          { code: "profile_output_too_big", count: Number.MAX_SAFE_INTEGER },
          { code: "profile_output_too_small", count: 4 },
          { code: "profile_output_unrecognized_keys", count: Number.MAX_SAFE_INTEGER },
          { code: "private_code_with_value", count: 7 },
          { code: "profile_output_invalid_value", count: -1 },
          { code: "profile_output_invalid_format", count: Number.NaN },
        ],
      },
    );

    const message = candidateProfileExtractionFailureMessage(error, "provider");

    expect(message).toContain("Renaming will not help");
    expect(message).toContain("invalid field types: 2");
    expect(message).toContain("fields over the size limit: 999+");
    expect(message).toContain("999+ other issues");
    expect(message.length).toBeLessThanOrEqual(240);
    expect(message).not.toMatch(/private|candidate|provider text|\/|\\/u);
  });

  it("shows recognized grounding counts only at the grounding stage", () => {
    const error = new CandidateProfileGroundingError([
      { code: "unknown_source", count: Number.MAX_SAFE_INTEGER },
      { code: "quote_not_in_source", count: 2 },
      { code: "value_not_in_quote", count: Number.MAX_SAFE_INTEGER },
    ]);
    const message = candidateProfileExtractionFailureMessage(error, "grounding");

    expect(message).toContain("could not be grounded");
    expect(message).toContain("No facts were saved");
    expect(message).toContain("unknown cited sources: 999+");
    expect(message).toContain("quotes absent from cited source text: 2");
    expect(message).toContain("values absent from evidence quotes: 999+");
    expect(message.length).toBeLessThanOrEqual(240);
    expect(message).not.toMatch(/\/|\\/u);
    expect(candidateProfileExtractionFailureMessage(error, "response-schema")).toBe(
      "The provider response did not match the required candidate profile format. Retry or check the configured model.",
    );
  });

  it("persists schema counts when the extraction port rejects at the provider stage", async () => {
    const result = await processCanonicalCandidateProfileExtraction(
      {
        extract: async () => {
          throw new ProviderAdapterError("deepinfra", "invalid-response", "private output", {
            failureStage: "response-schema-validation",
            diagnostics: [{ code: "output_schema_mismatch", path: "private/path" }],
            diagnosticCounts: [{ code: "profile_output_invalid_value", count: 2 }],
          });
        },
      },
      { operationId: "schema-guidance-test", sources: [source()], allowProviderData: true },
    );
    expect(result.facts).toEqual([]);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.message).toContain("invalid allowed values: 2");
    expect(result.issues[0]?.message).toContain("No facts were saved");
    expect(JSON.stringify(result)).not.toContain("private");
  });

  it("keeps generic schema guidance when DeepInfra diagnostic metadata is misleading", () => {
    const error = new ProviderAdapterError("openai", "invalid-response", "private", {
      diagnostics: [{ code: "output_schema_mismatch", path: "private/path" }],
      diagnosticCounts: [{ code: "profile_output_invalid_type", count: 3 }],
    });

    expect(candidateProfileExtractionFailureMessage(error, "response-schema")).toBe(
      "The provider response did not match the required candidate profile format. Retry or check the configured model.",
    );
    expect(
      candidateProfileExtractionFailureMessage(
        new ProviderAdapterError("deepinfra", "invalid-response", "private", {
          failureStage: "response-schema-validation",
          diagnostics: [{ code: "not_output_schema_mismatch", path: "private/path" }],
          diagnosticCounts: [{ code: "profile_output_invalid_type", count: 3 }],
        }),
        "response-schema",
      ),
    ).toBe(
      "The provider response did not match the required candidate profile format. Retry or check the configured model.",
    );
    expect(
      candidateProfileExtractionFailureMessage(
        new ProviderAdapterError("deepinfra", "invalid-response", "private", {
          failureStage: "transport-parsing",
          diagnostics: [{ code: "output_schema_mismatch", path: "private/path" }],
          diagnosticCounts: [{ code: "profile_output_invalid_type", count: 3 }],
        }),
        "response-schema",
      ),
    ).toBe(
      "The provider response did not match the required candidate profile format. Retry or check the configured model.",
    );
    expect(
      candidateProfileExtractionFailureMessage(
        new ProviderAdapterError("deepinfra", "invalid-response", "private", {
          diagnostics: [{ code: "output_schema_mismatch", path: "response" }],
          diagnosticCounts: [{ code: "unrecognized_private_count", count: 9 }],
        }),
        "response-schema",
      ),
    ).toBe(
      "The provider response did not match the required candidate profile format. Retry or check the configured model.",
    );
  });

  it("preserves generic grounding guidance when no recognized counts are available", () => {
    const message = candidateProfileExtractionFailureMessage(
      new CandidateProfileGroundingError([]),
      "grounding",
    );
    expect(message).toBe(
      "Extracted claims could not be grounded in the selected sources. No facts were saved; review the source material and try again.",
    );
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
