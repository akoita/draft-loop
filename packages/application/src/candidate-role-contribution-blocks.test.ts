import {
  type CandidateKnowledgeLexicalChunkInput,
  createCandidateKnowledgeLexicalHit,
} from "@draft-loop/domain";
import { describe, expect, it } from "vitest";

import { selectCandidateRoleContributionBlocks } from "./candidate-role-contribution-blocks.js";

const provenance = {
  storeId: "store-a",
  knowledgeBaseId: "knowledge-a",
  sourceId: "source-a",
  versionId: "version-a",
};

function chunk(
  chunkId: string,
  ordinal: number,
  lineStart: number,
  text: string,
): CandidateKnowledgeLexicalChunkInput {
  return {
    chunkId,
    ordinal,
    lineStart,
    lineEnd: lineStart + text.split("\n").length - 1,
    text,
    metadata: { provenance },
  };
}

describe("candidate role contribution blocks", () => {
  it("selects a relevant whole list item with nested caveats and exact source ranges", () => {
    const headingChunk = chunk(
      "role-heading",
      0,
      1,
      "## Juniper Systems — Application Engineer — January 2021 to present",
    );
    const heading = createCandidateKnowledgeLexicalHit({ ...headingChunk, bm25Rank: 1 });
    const introduction = chunk(
      "introduction",
      1,
      3,
      "Platform team context: coordinated shared planning and service ownership.",
    );
    const contributionText = [
      "### Contributions",
      "- Built async event replay from queued deliveries.",
      "  Caveat: retry remained manual in staging.",
      "- Added CI contract checks and release safety tests.",
      "### Interview notes",
      "Discussed alternate queue designs.",
      "## Other Employer — January 2024 to present",
    ].join("\n");
    const contributionChunk = chunk("contribution-region", 2, 5, contributionText);
    const selection = selectCandidateRoleContributionBlocks(
      heading,
      [headingChunk, introduction, contributionChunk],
      "async event replay",
      4_000,
    );

    expect(selection.foundRegion).toBe(true);
    expect(selection.blocks).toHaveLength(1);
    expect(selection.blocks[0]).toMatchObject({
      text: "- Built async event replay from queued deliveries.\n  Caveat: retry remained manual in staging.",
      lineStart: 6,
      lineEnd: 7,
      sourceRanges: [
        {
          chunkId: "contribution-region",
          startOffset: contributionText.indexOf("- Built async"),
          endOffset: contributionText.indexOf("\n- Added CI"),
        },
      ],
    });
    expect(selection.blocks[0]?.text).not.toContain("Platform team context");
    expect(selection.blocks[0]?.text).not.toContain("Interview notes");
    expect(selection.blocks[0]?.text).not.toContain("Other Employer");
  });

  it("keeps the prefix fallback available when a role has no recognized contribution anchor", () => {
    const headingChunk = chunk(
      "role-heading",
      0,
      1,
      "## Juniper Systems — Engineer — January 2021 to present",
    );
    const heading = createCandidateKnowledgeLexicalHit({ ...headingChunk, bm25Rank: 1 });
    const body = chunk("role-body", 1, 3, "Maintained the inherited scheduling service.");

    expect(
      selectCandidateRoleContributionBlocks(heading, [headingChunk, body], "scheduling", 4_000),
    ).toEqual({ foundRegion: false, blocks: [] });
  });

  it("ends a standalone contribution label before a following role subsection", () => {
    const headingChunk = chunk(
      "role-heading",
      0,
      1,
      "## Juniper Systems — Engineer — January 2021 to present",
    );
    const heading = createCandidateKnowledgeLexicalHit({ ...headingChunk, bm25Rank: 1 });
    const body = chunk(
      "role-body",
      1,
      3,
      [
        "**His work:**",
        "Maintained the inherited service and fixed scheduling reliability issues.",
        "",
        "### Interview notes",
        "Discussed alternate service designs.",
      ].join("\n"),
    );

    const selection = selectCandidateRoleContributionBlocks(
      heading,
      [headingChunk, body],
      "service scheduling reliability",
      4_000,
    );
    expect(selection.foundRegion).toBe(true);
    expect(selection.blocks.map(({ text }) => text)).toEqual([
      "Maintained the inherited service and fixed scheduling reliability issues.",
    ]);
  });

  it("does not reopen contribution selection inside a later interview subsection", () => {
    const headingChunk = chunk(
      "role-heading",
      0,
      1,
      "## Juniper Systems — Engineer — January 2021 to present",
    );
    const heading = createCandidateKnowledgeLexicalHit({ ...headingChunk, bm25Rank: 1 });
    const body = chunk(
      "role-body",
      1,
      3,
      [
        "### CV-usable facts",
        "- Maintained the inherited scheduling service and fixed reliability issues.",
        "### Interview notes",
        "#### Contributions",
        "- Designed event processing for an interview exercise.",
      ].join("\n"),
    );

    const selection = selectCandidateRoleContributionBlocks(
      heading,
      [headingChunk, body],
      "scheduling reliability event processing",
      4_000,
    );
    expect(selection.blocks.map(({ text }) => text)).toEqual([
      "- Maintained the inherited scheduling service and fixed reliability issues.",
    ]);
  });

  it("keeps a parent list item and split continuation lines atomic across chunks", () => {
    const headingChunk = chunk(
      "role-heading",
      0,
      1,
      "## Juniper Systems — Engineer — January 2021 to present",
    );
    const heading = createCandidateKnowledgeLexicalHit({ ...headingChunk, bm25Rank: 1 });
    const contributionText = "### Contributions\n- Built async event replay.";
    const caveatStart = "  Caveat: retries remained manual";
    const caveatEnd = " in staging.";
    const selection = selectCandidateRoleContributionBlocks(
      heading,
      [
        headingChunk,
        chunk("contribution-and-parent", 1, 3, contributionText),
        chunk("caveat-prefix", 2, 5, caveatStart),
        chunk("caveat-suffix", 3, 5, caveatEnd),
      ],
      "async event replay retries",
      4_000,
    );

    expect(selection.blocks).toHaveLength(1);
    expect(selection.blocks[0]).toMatchObject({
      text: "- Built async event replay.\n  Caveat: retries remained manual in staging.",
      lineStart: 4,
      lineEnd: 5,
      sourceRanges: [
        {
          chunkId: "contribution-and-parent",
          startOffset: contributionText.indexOf("- Built"),
          endOffset: contributionText.length,
        },
        { chunkId: "caveat-prefix", startOffset: 0, endOffset: caveatStart.length },
        { chunkId: "caveat-suffix", startOffset: 0, endOffset: caveatEnd.length },
      ],
    });
  });

  it("does not slice an oversized block and can still fit a later complete block", () => {
    const headingChunk = chunk(
      "role-heading",
      0,
      1,
      "## Juniper Systems — Engineer — January 2021 to present",
    );
    const heading = createCandidateKnowledgeLexicalHit({ ...headingChunk, bm25Rank: 1 });
    const bodyText = [
      "### CV-usable facts",
      `- Distributed processing ${"detail ".repeat(60)}`,
      "- Built API replay.",
    ].join("\n");
    const body = chunk("role-body", 1, 3, bodyText);
    const selection = selectCandidateRoleContributionBlocks(
      heading,
      [headingChunk, body],
      "distributed API",
      heading.text.length + 2 + "- Built API replay.".length,
    );

    expect(selection.foundRegion).toBe(true);
    expect(selection.blocks.map(({ text }) => text)).toEqual(["- Built API replay."]);
    expect(selection.blocks[0]?.text).not.toContain("detail");
  });
});
