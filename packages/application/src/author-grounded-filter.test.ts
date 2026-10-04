import type { ScoredEvidenceChunk } from "@draft-loop/domain";
import { type AuthorArtifactProposal, authorArtifactProposalSchema } from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";

import {
  filterGroundedAuthorProposal,
  ungroundedAuthorContentFindings,
} from "./author-grounded-filter.js";
import { completeCvProposalIssues } from "./complete-cv.js";

function chunk(id: string, text: string, rank = 0): ScoredEvidenceChunk {
  return {
    id,
    workspaceId: "workspace-1",
    sourceId: "source-1",
    ordinal: rank,
    lineStart: rank + 1,
    lineEnd: rank + 1,
    checksum: "a".repeat(64),
    text,
    rank,
  };
}

const evidence = [
  chunk("summary", "Backend engineer building TypeScript services.", 0),
  chunk("work", "Reduced processing time by 25 percent at Northwind Freight in 2021.", 1),
  chunk("tools", "Maintained deployment tooling for Northwind Freight.", 2),
];

interface BlockInput {
  readonly text: string;
  readonly claims: readonly string[];
  readonly cite: string;
}

function block({ text, claims, cite }: BlockInput) {
  return {
    type: "bullet" as const,
    text,
    claims: claims.map((claim) => ({
      text: claim,
      substantive: true,
      evidenceChunkIds: [cite],
    })),
  };
}

function proposal(experience: readonly BlockInput[]): AuthorArtifactProposal {
  return authorArtifactProposalSchema.parse({
    sections: [
      {
        title: "Summary",
        kind: "summary",
        blocks: [
          block({
            text: "Backend engineer building TypeScript services.",
            claims: ["Backend engineer building TypeScript services."],
            cite: "summary",
          }),
        ],
      },
      { title: "Experience", kind: "experience", blocks: experience.map(block) },
    ],
  });
}

const grounded: BlockInput = {
  text: "Reduced processing time by 25 percent.",
  claims: ["Reduced processing time by 25 percent."],
  cite: "work",
};
const inventedMetric: BlockInput = {
  text: "Reduced processing time by 60 percent.",
  claims: ["Reduced processing time by 60 percent."],
  cite: "work",
};
const inventedName: BlockInput = {
  text: "Maintained deployment tooling using Kafka.",
  claims: ["Maintained deployment tooling", "using Kafka"],
  cite: "tools",
};
const uncoveredEmployer: BlockInput = {
  text: "Maintained deployment tooling at Globex.",
  claims: ["Maintained deployment tooling"],
  cite: "tools",
};

describe("filterGroundedAuthorProposal", () => {
  it("returns the proposal unchanged when grounding passes", () => {
    const input = proposal([grounded]);
    expect(filterGroundedAuthorProposal(input, evidence)).toEqual({
      proposal: input,
      removedBlocks: 0,
      shortenedBlocks: 0,
    });
  });

  it("removes only the blocks whose claims fail grounding", () => {
    const input = proposal([inventedMetric, grounded, inventedName]);
    expect(completeCvProposalIssues(input, evidence).map(({ code }) => code)).toEqual([
      "factual_invariant_violation",
      "unsupported_claim",
      "factual_invariant_violation",
    ]);

    const result = filterGroundedAuthorProposal(input, evidence);

    expect(result?.removedBlocks).toBe(2);
    expect(result?.shortenedBlocks).toBe(0);
    expect(result?.proposal.sections[1]?.blocks.map(({ text }) => text)).toEqual([grounded.text]);
    expect(completeCvProposalIssues(result?.proposal ?? input, evidence)).toEqual([]);
  });

  it("shortens a block whose text adds an ungrounded fact around grounded claims", () => {
    const input = proposal([grounded, uncoveredEmployer]);
    expect(completeCvProposalIssues(input, evidence).map(({ code }) => code)).toEqual([
      "substantive_text_uncovered",
    ]);

    const result = filterGroundedAuthorProposal(input, evidence);

    expect(result?.removedBlocks).toBe(0);
    expect(result?.shortenedBlocks).toBe(1);
    expect(result?.proposal.sections[1]?.blocks[1]).toEqual({
      type: "bullet",
      text: "Maintained deployment tooling",
      claims: [
        { text: "Maintained deployment tooling", substantive: true, evidenceChunkIds: ["tools"] },
      ],
    });
  });

  it("joins the remaining claims of a shortened block without adding wording", () => {
    const input = proposal([
      {
        text: "Reduced processing time by 25 percent. Maintained deployment tooling at Globex.",
        claims: ["Reduced processing time by 25 percent.", "Maintained deployment tooling"],
        cite: "work",
      },
    ]);
    const evidenceWithTooling = [
      ...evidence,
      chunk(
        "work",
        "Reduced processing time by 25 percent at Northwind Freight in 2021. Maintained deployment tooling.",
        3,
      ),
    ].filter(({ rank }) => rank !== 1);

    const result = filterGroundedAuthorProposal(input, evidenceWithTooling);

    expect(result?.proposal.sections[1]?.blocks[0]?.text).toBe(
      "Reduced processing time by 25 percent. Maintained deployment tooling",
    );
    expect(result?.shortenedBlocks).toBe(1);
  });

  it("removes a section left without blocks", () => {
    const result = filterGroundedAuthorProposal(proposal([inventedMetric]), evidence);

    expect(result?.removedBlocks).toBe(1);
    expect(result?.proposal.sections.map(({ title }) => title)).toEqual(["Summary"]);
  });

  it("keeps failing closed when a required section would lose all its content", () => {
    expect(
      filterGroundedAuthorProposal(proposal([inventedMetric]), evidence, ["Experience"]),
    ).toBeUndefined();
  });

  it("keeps failing closed when no section would remain", () => {
    const input = authorArtifactProposalSchema.parse({
      sections: [{ title: "Experience", kind: "experience", blocks: [block(inventedMetric)] }],
    });

    expect(filterGroundedAuthorProposal(input, evidence)).toBeUndefined();
  });
});

describe("ungroundedAuthorContentFindings", () => {
  it("reports nothing when no content was left out", () => {
    expect(ungroundedAuthorContentFindings({ removedBlocks: 0, shortenedBlocks: 0 })).toEqual([]);
  });

  it.each([
    [
      1,
      0,
      "1 draft block was removed because the author's wording could not be matched to the cited evidence. Check the draft for missing content.",
    ],
    [
      2,
      1,
      "2 draft blocks were removed and 1 draft block was shortened because the author's wording could not be matched to the cited evidence. Check the draft for missing content.",
    ],
    [
      0,
      3,
      "3 draft blocks were shortened because the author's wording could not be matched to the cited evidence. Check the draft for missing content.",
    ],
  ])("reports %i removed and %i shortened blocks as one warning", (removed, shortened, message) => {
    expect(
      ungroundedAuthorContentFindings({ removedBlocks: removed, shortenedBlocks: shortened }),
    ).toEqual([
      {
        code: "ungrounded-author-content-dropped",
        category: "evidence",
        severity: "warning",
        message,
      },
    ]);
  });
});
