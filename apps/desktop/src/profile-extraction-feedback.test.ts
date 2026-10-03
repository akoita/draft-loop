import { processCanonicalCandidateProfileExtraction } from "@draft-loop/application";
import { ProviderAdapterError } from "@draft-loop/providers";
import { describe, expect, it } from "vitest";
import { safeCanonicalCandidateProfileFeedback } from "./profile-outcome.js";

function source() {
  return {
    id: "source-opaque",
    mediaType: "text/markdown" as const,
    checksum: "a".repeat(64),
    text: "Private candidate source material.",
    reference: {
      storeId: "store-opaque",
      knowledgeBaseId: "knowledge-opaque",
      sourceId: "source-opaque-record",
      versionId: "version-opaque",
      kind: "candidate-provided" as const,
    },
  };
}

async function savedMessage(diagnosticCounts?: readonly { code: string; count: number }[]) {
  const error = new ProviderAdapterError(
    "deepinfra",
    "invalid-response",
    "private response / candidate source content",
    {
      failureStage: "transport-parsing",
      diagnostics: [{ code: "malformed_stream", path: "private/source/path" }],
      ...(diagnosticCounts === undefined ? {} : { diagnosticCounts }),
    },
  );
  const result = await processCanonicalCandidateProfileExtraction(
    {
      extract: async () => {
        throw error;
      },
    },
    { operationId: "stream-feedback-test", sources: [source()], allowProviderData: true },
  );
  return result.issues[0]?.message ?? "";
}

describe("saved DeepInfra stream feedback", () => {
  it("keeps counted diagnostics through the real formatter and renderer sanitizer", async () => {
    const message = await savedMessage([
      { code: "stream_chunk_identity", count: 1 },
      { code: "stream_tool_data", count: 2 },
      { code: "private_source_path", count: 9 },
    ]);

    expect(message).toContain("inconsistent chunk identity: 1");
    expect(message).toContain("unsupported tool data: 2");
    expect(message.length).toBeLessThanOrEqual(240);
    expect(message).not.toContain("/");
    expect(message).not.toContain("private");
    expect(safeCanonicalCandidateProfileFeedback(message)).toBe(message);
  });

  it("keeps legacy malformed-stream guidance path-free without counts", async () => {
    const message = await savedMessage();
    expect(message).toBe(
      "DeepInfra returned a malformed GLM stream. Check provider or model compatibility and update DraftLoop; no facts were saved.",
    );
    expect(message).not.toContain("/");
    expect(safeCanonicalCandidateProfileFeedback(message)).toBe(message);
  });

  it("repairs only the exact historical persisted malformed-stream message", () => {
    const historical =
      "DeepInfra returned a malformed GLM stream. Check provider/model compatibility and update DraftLoop to the latest supported version; no facts were saved.";
    const safeMessage =
      "DeepInfra returned a malformed GLM stream. Check provider or model compatibility and update DraftLoop; no facts were saved.";

    expect(safeCanonicalCandidateProfileFeedback(historical)).toBe(safeMessage);
    expect(
      safeCanonicalCandidateProfileFeedback(
        "DeepInfra returned a malformed GLM stream. Check private/provider compatibility and update DraftLoop to the latest supported version; no facts were saved.",
      ),
    ).toBe("The canonical candidate profile operation could not be completed.");
  });
});
