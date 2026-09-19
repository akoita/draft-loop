import { describe, expect, it } from "vitest";

import {
  RejectedAuthorReplayBatchInputError,
  summarizeRejectedAuthorReplays,
} from "./rejected-author-replay-summary.js";

const privatePath = "/private/candidate/resume.md";
const evidenceText = "Built reliable TypeScript tools.";

function proposal(blockText = evidenceText, claimText = evidenceText) {
  return {
    sections: [
      {
        title: "Summary",
        kind: "summary",
        blocks: [
          {
            type: "paragraph",
            text: blockText,
            claims: [
              {
                text: claimText,
                substantive: true,
                evidenceChunkIds: ["chunk-1"],
              },
            ],
          },
        ],
      },
    ],
  };
}

function capture(proposalInput: unknown, modelId: string) {
  return {
    schemaVersion: 1,
    capturedAt: "2026-09-19T15:00:00.000Z",
    provider: "anthropic",
    modelId,
    validationInputs: {
      proposal: proposalInput,
      executionId: "synthetic-replay",
      context: {
        language: "en",
        evidenceManifest: [{ id: "source-1", path: privatePath, checksum: "a".repeat(64) }],
      },
      retrievedEvidence: [
        {
          id: "chunk-1",
          workspaceId: "workspace-1",
          sourceId: "source-1",
          ordinal: 0,
          lineStart: 1,
          lineEnd: 1,
          checksum: "b".repeat(64),
          text: evidenceText,
          rank: 0,
        },
      ],
      createdAt: "2026-09-19T15:00:00.000Z",
    },
    failureStage: "factual-invariant-rejection",
    diagnostics: [],
  };
}

describe("rejected author replay summary", () => {
  it("summarizes mixed cases with deterministic diagnostic counts", () => {
    const privateModel = "private-model-marker";
    const rejectedText = "Built 999 reliable TypeScript tools.";
    const result = summarizeRejectedAuthorReplays([
      capture(proposal(), privateModel),
      capture(proposal(rejectedText, rejectedText), privateModel),
      capture(proposal("Built tools across regulated industries.", "Built tools"), privateModel),
      capture(proposal("Built tools across private markets.", "Built tools"), privateModel),
    ]);

    expect(result).toEqual({
      total: 4,
      accepted: 1,
      rejected: 3,
      failureStages: [{ value: "factual-invariant-rejection", count: 3 }],
      diagnosticCodes: [
        { value: "factual_invariant_violation", count: 1 },
        { value: "substantive_text_uncovered", count: 2 },
      ],
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("999");
    expect(serialized).not.toContain("regulated");
    expect(serialized).not.toContain("markets");
    expect(serialized).not.toContain(evidenceText);
    expect(serialized).not.toContain(privatePath);
    expect(serialized).not.toContain("anthropic");
    expect(serialized).not.toContain(privateModel);
  });

  it.each([undefined, null, {}, [], Array.from({ length: 101 }, () => null)])(
    "rejects an invalid or unbounded batch with one fixed error",
    (input) => {
      expect(() => summarizeRejectedAuthorReplays(input)).toThrow(
        new RejectedAuthorReplayBatchInputError(),
      );
    },
  );

  it("preserves the fixed single-capture error without disclosing malformed content", () => {
    const privateMarker = "private malformed marker";
    expect(() => summarizeRejectedAuthorReplays([{ unexpected: privateMarker }])).toThrow(
      "Rejected author replay input is invalid.",
    );
    try {
      summarizeRejectedAuthorReplays([{ unexpected: privateMarker }]);
    } catch (error) {
      expect(String(error)).not.toContain(privateMarker);
    }
  });
});
