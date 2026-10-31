import { describe, expect, it } from "vitest";

import { evidenceUsage } from "./evidence-usage.js";

const sources = [
  { id: "src-cv", path: "evidence/cv.md" },
  { id: "src-notes", path: "evidence/notes.md" },
];
const retrieved = [
  { sourceId: "src-cv", lineStart: 10, lineEnd: 14, rank: 1 },
  { sourceId: "src-cv", lineStart: 40, lineEnd: 44, rank: 2 },
  { sourceId: "src-notes", lineStart: 1, lineEnd: 6, rank: 3 },
];

describe("evidenceUsage", () => {
  it("counts the sent chunks a claim cites, by overlapping line range in the same source", () => {
    const report = evidenceUsage(
      [
        { evidence: [{ sourcePath: "evidence/cv.md", locator: "line:12-13" }] },
        { evidence: [{ sourcePath: "evidence/notes.md", locator: "line:6-9" }] },
      ],
      retrieved,
      sources,
    );
    expect(report).toEqual({
      sent: 3,
      cited: 2,
      uncitedRanks: [2],
      claimsOutsideRetrieval: 0,
      claimsWithoutEvidence: 0,
    });
  });

  it("tells a claim outside the retrieved chunks from one without evidence", () => {
    const report = evidenceUsage(
      [
        // Same lines, other source: the path decides, not the line numbers.
        { evidence: [{ sourcePath: "evidence/notes.md", locator: "line:10-14" }] },
        { evidence: [{ sourcePath: "evidence/cv.md", locator: "line:90-92" }] },
        { evidence: [{ sourcePath: "evidence/elsewhere.md", locator: "line:10-14" }] },
        { evidence: [{ sourcePath: "evidence/cv.md" }] },
        { evidence: [] },
      ],
      retrieved,
      sources,
    );
    expect(report).toEqual({
      sent: 3,
      cited: 0,
      uncitedRanks: [1, 2, 3],
      claimsOutsideRetrieval: 4,
      claimsWithoutEvidence: 1,
    });
  });

  it("reports nothing sent and nothing cited for a run without retrieval", () => {
    expect(evidenceUsage([{ evidence: [] }], [], sources)).toEqual({
      sent: 0,
      cited: 0,
      uncitedRanks: [],
      claimsOutsideRetrieval: 0,
      claimsWithoutEvidence: 1,
    });
  });
});
