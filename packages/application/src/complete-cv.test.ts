import { renderArtifact } from "@draft-loop/rendering";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { buildAuthorArtifact } from "./author-output.js";

const checksum = "a".repeat(64);
const sectionKinds = [
  "header",
  "summary",
  "experience",
  "projects",
  "skills",
  "education",
  "certifications",
  "languages",
] as const;
const sectionText = [
  "Ada Lovelace | ada@example.com | https://example.com/ada",
  "Staff Engineer building TypeScript platforms.",
  "Staff Engineer at Analytical Engines, 2022-2026.",
  "Led the Reliable Compiler project.",
  "TypeScript, distributed systems",
  "MSc Computer Science, Example University, 2021.",
  "AWS Certified Developer, 2020.",
  "English and French",
] as const;
const retrievedEvidence = sectionText.map((text, index) => ({
  id: `chunk-${index}`,
  workspaceId: "workspace-1",
  sourceId: "source-1",
  ordinal: index,
  lineStart: index + 1,
  lineEnd: index + 1,
  checksum,
  text,
  rank: index,
}));

const compoundClaimText =
  "Staff Engineer at Analytical Engines led the Reliable Compiler project in 2022-2026.";
const compoundRetrievedEvidence = [
  ...retrievedEvidence,
  {
    id: "chunk-compound-role",
    workspaceId: "workspace-1",
    sourceId: "source-1",
    ordinal: 8,
    lineStart: 9,
    lineEnd: 9,
    checksum,
    text: "Staff Engineer at Analytical Engines, 2022-2026.",
    rank: 8,
  },
  {
    id: "chunk-compound-project",
    workspaceId: "workspace-1",
    sourceId: "source-1",
    ordinal: 9,
    lineStart: 10,
    lineEnd: 10,
    checksum,
    text: "Led the Reliable Compiler project.",
    rank: 9,
  },
];

function proposal(texts: readonly string[] = sectionText) {
  return {
    sections: sectionKinds.map((kind, index) => ({
      title: kind[0]?.toUpperCase() + kind.slice(1),
      kind,
      blocks: [
        {
          type:
            kind === "summary" || kind === "header" ? ("paragraph" as const) : ("bullet" as const),
          text: texts[index] ?? sectionText[index],
          claims: [
            {
              text: texts[index] ?? sectionText[index],
              substantive: true,
              evidenceChunkIds: [`chunk-${index}`],
            },
          ],
        },
      ],
    })),
  };
}

function compoundProposal(evidenceChunkIds: readonly string[]) {
  const base = proposal();
  return {
    ...base,
    sections: base.sections.map((section, sectionIndex) => {
      if (sectionIndex !== 1) return section;
      const block = section.blocks[0];
      if (block === undefined) throw new Error("summary block is missing");
      const claim = block.claims[0];
      if (claim === undefined) throw new Error("summary claim is missing");
      return {
        ...section,
        blocks: [
          {
            ...block,
            text: compoundClaimText,
            claims: [
              { ...claim, text: compoundClaimText, evidenceChunkIds: [...evidenceChunkIds] },
            ],
          },
        ],
      };
    }),
  };
}

const context = {
  language: "en",
  evidenceManifest: [{ id: "source-1", path: "/local/cv.md", checksum }],
} as const;

describe("complete CV composition", () => {
  it("retains all supported sections and chronology through Markdown, DOCX, and PDF", () => {
    const artifact = buildAuthorArtifact({
      proposal: proposal(),
      executionId: "complete-cv",
      context,
      retrievedEvidence,
      createdAt: "2026-08-30T10:00:00.000Z",
    });

    expect(artifact.sections.map((section) => section.kind)).toEqual(sectionKinds);
    expect(artifact.sections[2]?.blocks[0]?.text).toContain("2022-2026");
    for (const format of ["markdown", "docx", "pdf"] as const) {
      expect(
        renderArtifact(artifact, format, { requiredSections: [...sectionKinds] }).content.length,
      ).toBeGreaterThan(0);
    }
  });

  it("requires every evidence chunk for protected values split across a compound claim", () => {
    const artifact = buildAuthorArtifact({
      proposal: compoundProposal(["chunk-compound-role", "chunk-compound-project"]),
      executionId: "compound-cv",
      context,
      retrievedEvidence: compoundRetrievedEvidence,
    });

    expect(artifact.sections[1]?.blocks[0]?.text).toContain("Reliable Compiler");
    expect(() =>
      buildAuthorArtifact({
        proposal: compoundProposal(["chunk-compound-role"]),
        executionId: "compound-cv-missing-evidence",
        context,
        retrievedEvidence: compoundRetrievedEvidence,
      }),
    ).toThrow(z.ZodError);
  });

  it("rejects unsupported claims and changed factual invariants", () => {
    const unsupported: string[] = [...sectionText];
    unsupported[2] = "Principal Engineer at Invented Corp, 2020-2026.";

    expect(() =>
      buildAuthorArtifact({
        proposal: proposal(unsupported),
        executionId: "unsupported-cv",
        context,
        retrievedEvidence,
      }),
    ).toThrow(z.ZodError);
  });
});
