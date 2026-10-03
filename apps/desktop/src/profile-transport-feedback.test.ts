import { processCanonicalCandidateProfileExtraction } from "@draft-loop/application";
import { ProviderAdapterError } from "@draft-loop/providers";
import { describe, expect, it } from "vitest";
import { safeCanonicalCandidateProfileFeedback } from "./profile-outcome.js";

function source() {
  return {
    id: "source-a",
    mediaType: "text/plain" as const,
    checksum: "a".repeat(64),
    text: "Private candidate source material.",
    reference: {
      storeId: "store-a",
      knowledgeBaseId: "knowledge-a",
      sourceId: "document-a",
      versionId: "version-a",
      kind: "candidate-provided" as const,
    },
  };
}

const guidanceCases = [
  {
    name: "initial timeout",
    error: () =>
      new ProviderAdapterError("deepinfra", "timeout", "private", {
        diagnostics: [{ code: "stream_timeout_initial", path: "private/path" }],
      }),
    expected:
      "DeepInfra did not begin the GLM response in time. Check provider status or the network connection; no facts were saved.",
  },
  {
    name: "idle timeout",
    error: () =>
      new ProviderAdapterError("deepinfra", "timeout", "private", {
        diagnostics: [{ code: "stream_timeout_idle", path: "private/path" }],
      }),
    expected:
      "The DeepInfra GLM stream stopped producing chunks. Check provider status or the network connection; no facts were saved.",
  },
  {
    name: "total timeout",
    error: () =>
      new ProviderAdapterError("deepinfra", "timeout", "private", {
        diagnostics: [{ code: "stream_timeout_total", path: "private/path" }],
      }),
    expected:
      "The DeepInfra GLM stream exceeded its total time limit. Check provider status or the network connection; no facts were saved.",
  },
  {
    name: "generic timeout",
    error: () => new ProviderAdapterError("deepinfra", "timeout", "private"),
    expected:
      "The DeepInfra GLM response timed out. Check provider status or the network connection, or choose another supported model; no facts were saved.",
  },
  ...([500, 502, 503, 504] as const).map((status) => ({
    name: `transient ${status}`,
    error: () => new ProviderAdapterError("deepinfra", "transient", "private", { status }),
    expected: `DeepInfra returned HTTP ${status} while generating the GLM profile. Check provider status or the network connection; no facts were saved.`,
  })),
  {
    name: "generic transient",
    error: () => new ProviderAdapterError("deepinfra", "transient", "private"),
    expected:
      "DeepInfra temporarily failed while generating the GLM profile. Check provider status or the network connection, then retry; no facts were saved.",
  },
] as const;

describe("saved GLM transport feedback", () => {
  it.each(guidanceCases)(
    "keeps $name guidance visible in the renderer",
    async ({ error, expected }) => {
      const selected = source();
      const result = await processCanonicalCandidateProfileExtraction(
        {
          extract: async () => {
            throw error();
          },
        },
        {
          operationId: "desktop-transport-feedback-test",
          sources: [selected],
          allowProviderData: true,
        },
      );
      const message = result.issues[0]?.message ?? "";

      expect(result.facts).toEqual([]);
      expect(result.issues[0]?.sourceRefs).toContainEqual(selected.reference);
      expect(message).toBe(expected);
      expect(safeCanonicalCandidateProfileFeedback(message)).toBe(message);
    },
  );
});
