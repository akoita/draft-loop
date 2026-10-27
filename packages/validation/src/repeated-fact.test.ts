import type { DraftArtifact } from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";

import { validateDraftArtifact } from "./index.js";
import { findRepeatedFacts } from "./repeated-fact.js";

// A fictional profile: the same two facts restated in Summary, Core areas and Experience.
const sections = [
  ["section-summary", "Summary"],
  ["section-core", "Core areas"],
  ["section-experience", "Experience"],
] as const;
const claims = [
  ["c-1", "section-summary", "Technical lead for the document ingestion feature at a fintech."],
  ["c-2", "section-summary", "Builds reliable Python services on PostgreSQL."],
  ["c-3", "section-core", "Technical lead of the document ingestion feature."],
  ["c-4", "section-core", "Coding agents in daily delivery work."],
  [
    "c-5",
    "section-experience",
    "Led the document ingestion feature as technical lead at a fintech, from design to launch.",
  ],
  ["c-6", "section-experience", "Cut invoice processing time by moving batch jobs to queues."],
] as const;

function draft(): DraftArtifact {
  return {
    schemaVersion: 1,
    id: "artifact-1",
    version: 1,
    parentVersionId: null,
    createdAt: "2026-10-27T10:00:00.000Z",
    language: "en",
    sections: sections.map(([id, title], order) => ({
      id,
      title,
      kind: "custom",
      order,
      blocks: claims
        .filter(([, sectionId]) => sectionId === id)
        .map(([claimId, , text]) => ({
          id: `block-${claimId}`,
          type: "bullet",
          text,
          claimIds: [claimId],
        })),
    })),
    claims: claims.map(([id, sectionId, text]) => ({
      id,
      text,
      sectionId,
      blockId: `block-${id}`,
      substantive: true,
      status: "verified",
      evidence: [{ sourcePath: "/local/evidence.txt", excerpt: text }],
    })),
    decisions: [],
  } as unknown as DraftArtifact;
}

describe("repeated facts", () => {
  it("groups a reworded fact across sections and leaves distinct facts alone", () => {
    expect(findRepeatedFacts(draft().claims)).toEqual([
      {
        claimIds: ["c-1", "c-3", "c-5"],
        sectionIds: ["section-summary", "section-core", "section-experience"],
      },
    ]);
  });

  it("warns once per repeated fact, naming each section", () => {
    const issues = validateDraftArtifact(draft(), {
      requirements: [],
      outputConstraints: { requiredSections: [] },
    }).issues.filter(({ code }) => code === "repeated-fact");
    expect(issues).toEqual([
      {
        code: "repeated-fact",
        category: "quality",
        severity: "warning",
        message:
          "the same fact is stated in Summary, Core areas and Experience; state it once, in the section where it fits best",
        claimId: "c-3",
        sectionId: "section-core",
      },
    ]);
  });

  it("ignores the same section, short labels, non-substantive claims and exact copies", () => {
    const base = { substantive: true };
    expect(
      findRepeatedFacts([
        { ...base, id: "a", sectionId: "s-1", text: "Python services on PostgreSQL at scale." },
        { ...base, id: "b", sectionId: "s-1", text: "Python services on PostgreSQL at scale!" },
        { ...base, id: "c", sectionId: "s-2", text: "Python, PostgreSQL" },
        { ...base, id: "d", sectionId: "s-3", text: "Python, PostgreSQL" },
        {
          id: "e",
          sectionId: "s-4",
          text: "Python services on PostgreSQL at scale.",
          substantive: false,
        },
        { ...base, id: "f", sectionId: "s-5", text: "Ran weekly design reviews with product." },
        { ...base, id: "g", sectionId: "s-6", text: "Ran weekly design reviews with product." },
      ]),
    ).toEqual([]);
  });
});
