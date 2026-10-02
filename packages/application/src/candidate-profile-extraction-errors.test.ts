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

describe("candidate profile extraction billing guidance", () => {
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
