import type { RunSnapshot } from "@draft-loop/orchestrator";
import { describe, expect, it } from "vitest";

import { comparedVersion, reviewArtifact } from "./review-state.js";

type DraftArtifact = NonNullable<RunSnapshot["artifact"]>;

const noDecisions = { decisions: {}, rationales: {}, edits: {}, history: [] };
const excerpt = "Synthetic source chunk. ".repeat(160);

const draft = {
  schemaVersion: 1,
  id: "artifact-1",
  version: 1,
  parentVersionId: null,
  createdAt: "2026-11-20T10:00:00.000Z",
  language: "en",
  sections: [
    {
      id: "experience",
      title: "Experience",
      kind: "experience",
      order: 0,
      blocks: [
        {
          id: "block-1",
          type: "bullet",
          text: "Built synthetic ingestion tools.",
          claimIds: ["claim-1"],
        },
      ],
    },
  ],
  claims: [
    {
      id: "claim-1",
      text: "Built synthetic ingestion tools.",
      status: "supported",
      evidence: [{ sourcePath: "cv.md", excerpt }],
    },
  ],
  decisions: [],
} as unknown as DraftArtifact;

describe("the previous version in the review state (#3258)", () => {
  it("keeps the sections and their text the comparison reads", () => {
    const previous = comparedVersion(reviewArtifact(draft, noDecisions));
    expect(previous).toMatchObject({ id: "artifact-1", version: 1 });
    expect(previous.sections).toEqual([
      {
        id: "experience",
        title: "Experience",
        kind: "experience",
        blocks: [
          { id: "block-1", type: "bullet", text: "Built synthetic ingestion tools.", claimIds: [] },
        ],
      },
    ]);
  });

  it("leaves its claims and their evidence excerpts behind", () => {
    const current = reviewArtifact(draft, noDecisions);
    const previous = comparedVersion(current);
    expect(previous.claims).toEqual([]);
    expect(JSON.stringify(previous)).not.toContain("Synthetic source chunk.");
    // The current draft keeps them: the claim panel shows each excerpt.
    expect(current.claims[0]?.evidence[0]?.excerpt).toBe(excerpt);
  });
});
