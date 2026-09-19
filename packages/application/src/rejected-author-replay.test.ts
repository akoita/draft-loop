import { describe, expect, it } from "vitest";

import {
  RejectedAuthorReplayInputError,
  replayRejectedAuthorCapture,
} from "./rejected-author-replay.js";

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

function capture(proposalInput: unknown) {
  return {
    schemaVersion: 1,
    capturedAt: "2026-09-19T15:00:00.000Z",
    provider: "anthropic",
    modelId: "claude-sonnet-4-5",
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

describe("rejected author replay", () => {
  it("replays an accepted proposal without returning private content", () => {
    const result = replayRejectedAuthorCapture(capture(proposal()));
    expect(result).toEqual({ status: "accepted" });
    expect(JSON.stringify(result)).not.toContain(privatePath);
    expect(JSON.stringify(result)).not.toContain(evidenceText);
  });

  it("reproduces factual-invariant diagnostics without returning prose", () => {
    const rejectedText = "Built 999 reliable TypeScript tools.";
    const result = replayRejectedAuthorCapture(capture(proposal(rejectedText, rejectedText)));
    expect(result).toEqual({
      status: "rejected",
      failureStage: "factual-invariant-rejection",
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: "factual_invariant_violation" }),
      ]),
    });
    expect(JSON.stringify(result)).not.toContain("999");
    expect(JSON.stringify(result)).not.toContain(evidenceText);
  });

  it("reproduces substantive coverage diagnostics without returning prose", () => {
    const result = replayRejectedAuthorCapture(
      capture(proposal("Built tools across regulated industries.", "Built tools")),
    );
    expect(result).toEqual({
      status: "rejected",
      failureStage: "factual-invariant-rejection",
      diagnostics: expect.arrayContaining([
        {
          code: "substantive_text_uncovered",
          path: "sections.0.blocks.0.text",
        },
      ]),
    });
    expect(JSON.stringify(result)).not.toContain("regulated");
  });

  it.each([
    null,
    {},
    { ...capture(proposal()), schemaVersion: 2 },
    { ...capture(proposal()), unexpected: "private value" },
    { ...capture(proposal()), validationInputs: { proposal: {} } },
  ])("rejects malformed captures with one fixed content-free error", (input) => {
    expect(() => replayRejectedAuthorCapture(input)).toThrow(new RejectedAuthorReplayInputError());
    try {
      replayRejectedAuthorCapture(input);
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain("private value");
      expect(String(error)).toBe(
        "RejectedAuthorReplayInputError: Rejected author replay input is invalid.",
      );
    }
  });
});
