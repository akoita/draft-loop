import { ProviderAdapterError } from "@draft-loop/providers";
import { describe, expect, it } from "vitest";
import { processCanonicalCandidateProfileExtraction } from "./candidate-profile-extraction.js";
import { candidateProfileExtractionFailureMessage } from "./candidate-profile-extraction-errors.js";

const genericTimeoutMessage =
  "The DeepInfra GLM response timed out. Check provider status or the network connection, or choose another supported model; no facts were saved.";
const genericTransientMessage =
  "DeepInfra temporarily failed while generating the GLM profile. Check provider status or the network connection, then retry; no facts were saved.";

function timeoutError(
  diagnostics: readonly { readonly code: string; readonly path: string }[] = [],
  diagnosticCounts: readonly { readonly code: string; readonly count: number }[] = [],
) {
  return new ProviderAdapterError(
    "deepinfra",
    "timeout",
    "private timeout text containing candidate data and a secret path",
    { diagnostics, diagnosticCounts },
  );
}

function source() {
  return {
    id: "source-a",
    mediaType: "text/plain",
    checksum: "a".repeat(64),
    text: "Candidate source text remains local.",
    reference: {
      storeId: "store-a",
      knowledgeBaseId: "knowledge-a",
      sourceId: "document-a",
      versionId: "version-a",
      kind: "candidate-provided" as const,
    },
  };
}

describe("DeepInfra GLM transport failure guidance", () => {
  it.each([
    [
      "stream_timeout_initial",
      "DeepInfra did not begin the GLM response in time. Check provider status or the network connection; no facts were saved.",
    ],
    [
      "stream_timeout_idle",
      "The DeepInfra GLM stream stopped producing chunks. Check provider status or the network connection; no facts were saved.",
    ],
    [
      "stream_timeout_total",
      "The DeepInfra GLM stream exceeded its total time limit. Check provider status or the network connection; no facts were saved.",
    ],
  ])("maps %s to fixed phase guidance", (code, message) => {
    const guidance = candidateProfileExtractionFailureMessage(
      timeoutError([{ code, path: "private/candidate/path" }]),
      "provider",
    );

    expect(guidance).toBe(message);
    expect(guidance.length).toBeLessThanOrEqual(240);
    expect(guidance).not.toMatch(/[/\\]/u);
    expect(guidance).not.toContain("private");
    expect(guidance).not.toContain("candidate data");
  });

  it("uses generic timeout guidance for absent, conflicting, or unrecognized phases", () => {
    expect(candidateProfileExtractionFailureMessage(timeoutError(), "provider")).toBe(
      genericTimeoutMessage,
    );
    expect(
      candidateProfileExtractionFailureMessage(
        timeoutError([
          { code: "stream_timeout_initial", path: "initial" },
          { code: "stream_timeout_idle", path: "idle" },
        ]),
        "provider",
      ),
    ).toBe(genericTimeoutMessage);
    expect(
      candidateProfileExtractionFailureMessage(
        timeoutError([{ code: "stream_timeout_total/private", path: "private" }]),
        "provider",
      ),
    ).toBe(genericTimeoutMessage);
    expect(
      candidateProfileExtractionFailureMessage(
        timeoutError(
          [{ code: "stream_timeout_initial", path: "safe" }],
          [{ code: "stream_timeout_idle", count: 1 }],
        ),
        "provider",
      ),
    ).toContain("did not begin the GLM response");
  });

  it("deduplicates repeated phase diagnostics", () => {
    const guidance = candidateProfileExtractionFailureMessage(
      timeoutError([
        { code: "stream_timeout_idle", path: "idle" },
        { code: "stream_timeout_idle", path: "duplicate" },
      ]),
      "provider",
    );

    expect(guidance).toBe(
      "The DeepInfra GLM stream stopped producing chunks. Check provider status or the network connection; no facts were saved.",
    );
  });

  it.each([
    [500, "HTTP 500"],
    [502, "HTTP 502"],
    [503, "HTTP 503"],
    [504, "HTTP 504"],
  ])("identifies only allowlisted transient status %i", (status, label) => {
    const guidance = candidateProfileExtractionFailureMessage(
      new ProviderAdapterError("deepinfra", "transient", "private HTTP body", { status }),
      "provider",
    );

    expect(guidance).toContain(label);
    expect(guidance.length).toBeLessThanOrEqual(240);
    expect(guidance).not.toMatch(/[/\\]/u);
    expect(guidance).not.toContain("private HTTP body");
  });

  it("uses generic interruption guidance for unlisted transient statuses", () => {
    for (const status of [undefined, 501, 599]) {
      const guidance = candidateProfileExtractionFailureMessage(
        new ProviderAdapterError("deepinfra", "transient", "private", {
          ...(status === undefined ? {} : { status }),
        }),
        "provider",
      );
      expect(guidance).toBe(genericTransientMessage);
    }
  });

  it("does not specialize other providers, error codes, or non-adapter errors", () => {
    expect(
      candidateProfileExtractionFailureMessage(
        new ProviderAdapterError("anthropic", "timeout", "private", {
          diagnostics: [{ code: "stream_timeout_initial", path: "private" }],
        }),
        "provider",
      ),
    ).toBe("The provider request timed out or failed temporarily. Retry in a moment.");
    expect(
      candidateProfileExtractionFailureMessage(
        new ProviderAdapterError("deepinfra", "rate-limit", "private", { status: 503 }),
        "provider",
      ),
    ).toBe(
      "The provider rate limit or quota was reached. Check the account limit and retry later.",
    );
    expect(
      candidateProfileExtractionFailureMessage(new Error("private provider text"), "provider"),
    ).toBe(
      "The provider failed during candidate profile extraction for an unknown reason. Check the configured provider and retry.",
    );
  });

  it("saves a path-free omission with source provenance and no facts", async () => {
    const selected = source();
    const error = timeoutError([{ code: "stream_timeout_total", path: "private/path" }]);
    const result = await processCanonicalCandidateProfileExtraction(
      {
        extract: async () => {
          throw error;
        },
      },
      {
        operationId: "transport-guidance-test",
        sources: [selected],
        allowProviderData: true,
      },
    );

    expect(result.facts).toEqual([]);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      code: "omission",
      severity: "error",
      status: "open",
      message:
        "The DeepInfra GLM stream exceeded its total time limit. Check provider status or the network connection; no facts were saved.",
      sourceRefs: [selected.reference],
    });
    expect(JSON.stringify(result)).not.toContain("private timeout text");
    expect(JSON.stringify(result)).not.toContain("private/path");
  });
});
