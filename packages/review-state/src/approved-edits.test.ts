import { applyCandidateEdits } from "@draft-loop/orchestrator";
import { describe, expect, it } from "vitest";

import { reviewArtifact } from "./review-state.js";

type DraftArtifact = Parameters<typeof applyCandidateEdits>[0];

const noDecisions = { decisions: {}, rationales: {}, edits: {}, history: [] };

const reviewed: DraftArtifact = {
  schemaVersion: 1,
  id: "artifact-1",
  version: 1,
  parentVersionId: null,
  createdAt: "2026-10-28T10:00:00.000Z",
  language: "en",
  sections: [
    {
      id: "experience",
      title: "Experience",
      kind: "experience",
      order: 0,
      blocks: [
        { id: "block-1", type: "bullet", text: "Built synthetic ingestion tools.", claimIds: [] },
        { id: "block-2", type: "bullet", text: "Kept synthetic tests green.", claimIds: [] },
      ],
    },
  ],
  claims: [],
  decisions: [],
};

describe("edited blocks in the review state", () => {
  it("marks the blocks an approved version took from the candidate's edits", () => {
    const approved = applyCandidateEdits(
      reviewed,
      [{ blockId: "block-1", text: "Built synthetic ingestion tools with retries." }],
      "2026-10-28T11:00:00.000Z",
    );

    const [first, second] = reviewArtifact(approved, noDecisions).sections[0]?.blocks ?? [];

    expect(first).toMatchObject({
      text: "Built synthetic ingestion tools with retries.",
      edited: true,
    });
    expect(second?.edited).toBeUndefined();
  });

  it("marks a block the candidate edited in the review before approval", () => {
    const [first, second] =
      reviewArtifact(reviewed, { ...noDecisions, edits: { "block-2": "Kept every test green." } })
        .sections[0]?.blocks ?? [];

    expect(first?.edited).toBeUndefined();
    expect(second).toMatchObject({ text: "Kept every test green.", edited: true });
  });
});
