import type {
  CandidateKnowledgeLexicalChunkInput,
  CandidateKnowledgeLexicalHit,
} from "@draft-loop/domain";
import { createCandidateKnowledgeLexicalHit } from "@draft-loop/domain";
import { describe, expect, it } from "vitest";
import { selectCandidateIndependentProjectEvidence } from "./candidate-independent-project-evidence.js";

const provenance = {
  storeId: "store-a",
  knowledgeBaseId: "knowledge-a",
  sourceId: "source-a",
  versionId: "version-a",
};

function source(
  text: string,
  options: { readonly versionId?: string } = {},
): CandidateKnowledgeLexicalChunkInput {
  const lineCount = text.split("\n").length;
  return {
    chunkId: "independent-source",
    ordinal: 0,
    lineStart: 1,
    lineEnd: lineCount,
    text,
    metadata: {
      provenance: { ...provenance, versionId: options.versionId ?? provenance.versionId },
    },
  };
}

function headingHit(chunk: CandidateKnowledgeLexicalChunkInput): CandidateKnowledgeLexicalHit {
  return createCandidateKnowledgeLexicalHit({ ...chunk, bm25Rank: 0 });
}

describe("candidate independent project evidence", () => {
  it("selects relevant complete projects in requested order and keeps scoped limitations", () => {
    const chunk = source(
      [
        "## Independent Work — January 2021 to present",
        "All independent projects are prototypes, not in production.",
        "",
        "**SignalDeck**, a Java platform for distributed event processing.",
        "Distributed messaging design and asynchronous delivery.",
        "- Designed a concurrent event core with replay.",
        "  Caveat: demonstration only; no production users.",
        "",
        "**PaperHarbor**, a creative-writing anthology.",
        "- Curated a collection of fictional essays.",
        "",
        "**LedgerKit**, a distributed platform for event processing.",
        "- Built an event-ingestion service using Java.",
        "**Honesty constraints:** This project remained a prototype; staging only.",
      ].join("\n"),
    );

    const result = selectCandidateIndependentProjectEvidence(
      headingHit(chunk),
      [chunk],
      "Java concurrent event processing distributed platform",
      "Prioritize LedgerKit / SignalDeck.",
      4_000,
    );

    expect(result.foundRegion).toBe(true);
    expect(result.decision).toBe("selected");
    expect(result.projectDecisions).toEqual([
      { title: "SignalDeck", decision: "selected" },
      { title: "PaperHarbor", decision: "no-job-overlap" },
      { title: "LedgerKit", decision: "selected" },
    ]);
    const text = result.blocks.map(({ text: blockText }) => blockText).join("\n\n");
    expect(text.indexOf("**LedgerKit**")).toBeLessThan(text.indexOf("**SignalDeck**"));
    expect(text).toContain("Built an event-ingestion service using Java.");
    expect(text).toContain("Distributed messaging design and asynchronous delivery.");
    expect(text).toContain("Caveat: demonstration only; no production users.");
    expect(text).toContain("staging only.");
    expect(text).toContain("All independent projects are prototypes, not in production.");
    expect(text).not.toContain("Java Core");
    expect(text.length).toBeLessThanOrEqual(4_000);
    expect(result.blocks[0]?.sourceRanges[0]?.startOffset).toBe(
      chunk.text.indexOf("**LedgerKit**"),
    );
    expect(
      result.blocks
        .flatMap(({ sourceRanges }) => sourceRanges)
        .map(({ startOffset }) => startOffset),
    ).toContain(chunk.text.indexOf("- Built an event-ingestion service"));
  });

  it("returns only the heading when recognized projects have no substantive job overlap", () => {
    const chunk = source(
      [
        "## Independent Projects — January 2021 to present",
        "**Canvas**, a collection of short stories.",
        "- Edited fictional essays and poems.",
      ].join("\n"),
    );
    const result = selectCandidateIndependentProjectEvidence(
      headingHit(chunk),
      [chunk],
      "you can work with other projects",
      "",
      4_000,
    );

    expect(result.foundRegion).toBe(true);
    expect(result.decision).toBe("no-job-overlap");
    expect(result.blocks).toEqual([]);
    expect(result.projectDecisions).toEqual([{ title: "Canvas", decision: "no-job-overlap" }]);
  });

  it("skips a whole relevant bundle that cannot fit and reports its budget decision", () => {
    const chunk = source(
      [
        "## Independent Work — January 2021 to present",
        "**EventLab**, an experimental sketchbook.",
        `- Built a ${"distributed event processing system with Kafka. ".repeat(6)}`,
      ].join("\n"),
    );
    const result = selectCandidateIndependentProjectEvidence(
      headingHit(chunk),
      [chunk],
      "distributed event processing Kafka",
      "",
      120,
    );

    expect(result.foundRegion).toBe(true);
    expect(result.decision).toBe("budget");
    expect(result.blocks).toEqual([]);
    expect(result.projectDecisions).toEqual([{ title: "EventLab", decision: "budget" }]);
  });

  it("admits explicitly requested projects before stronger job matches and keeps their evidence", () => {
    const chunk = source(
      [
        "## Independent Work — January 2021 to present",
        "**EventEngine**, a Java event-processing platform.",
        "**Honesty constraints:** Prototype only; no production users. This is a bounded fictional fixture. ".repeat(
          3,
        ),
        "**Canvas / Canvas Index**, a civic library catalogue.",
        "Curated a searchable lending index for community equipment.",
        "**Honesty constraints:** Demonstration only; no production users.",
      ].join("\n"),
    );

    const result = selectCandidateIndependentProjectEvidence(
      headingHit(chunk),
      [chunk],
      "Java event processing",
      "Prioritize Canvas Index.",
      500,
    );

    expect(result.projectDecisions).toEqual([
      { title: "EventEngine", decision: "budget" },
      { title: "Canvas / Canvas Index", decision: "selected" },
    ]);
    const text = result.blocks.map(({ text: blockText }) => blockText).join("\n\n");
    expect(text).toContain("**Canvas / Canvas Index**");
    expect(text).toContain("Curated a searchable lending index for community equipment.");
    expect(text).toContain("Demonstration only; no production users.");
    expect(text).not.toContain("EventEngine");
    expect(text.length).toBeLessThanOrEqual(500);
  });

  it("matches source-declared slash aliases as whole phrases, not title substrings", () => {
    const chunk = source(
      [
        "## Independent Work — January 2021 to present",
        "**SignalDeck Pro**, a Java event-processing platform.",
        "Built a Java event processor with retry-safe replay.",
        "**LedgerKit / Ledger Path**, a civic lending catalogue.",
        "Curated a searchable lending index for community equipment.",
      ].join("\n"),
    );

    const result = selectCandidateIndependentProjectEvidence(
      headingHit(chunk),
      [chunk],
      "Java event processing",
      "Prioritize SignalDeck, then Ledger Path.",
      4_000,
    );

    const text = result.blocks.map(({ text: blockText }) => blockText).join("\n\n");
    expect(text.indexOf("**LedgerKit / Ledger Path**")).toBeLessThan(
      text.indexOf("**SignalDeck Pro**"),
    );
    expect(result.projectDecisions).toEqual([
      { title: "SignalDeck Pro", decision: "selected" },
      { title: "LedgerKit / Ledger Path", decision: "selected" },
    ]);
  });

  it("stops before a nested dated role and rejects mixed source versions", () => {
    const chunk = source(
      [
        "## Independent Work — January 2021 to present",
        "**SignalDeck**, a Java platform for event processing.",
        "- Built a concurrent event core.",
        "#### Juniper Systems — Backend Engineer — January 2020 to December 2020",
        "**HiddenProject**, distributed event processing.",
      ].join("\n"),
    );
    const result = selectCandidateIndependentProjectEvidence(
      headingHit(chunk),
      [chunk],
      "Java concurrent event processing",
      "",
      4_000,
    );
    expect(result.blocks.map(({ text }) => text).join("\n\n")).not.toContain("HiddenProject");

    const otherVersion = source("- Body from another version.", { versionId: "version-b" });
    expect(
      selectCandidateIndependentProjectEvidence(
        headingHit(chunk),
        [chunk, otherVersion],
        "Java event processing",
        "",
        4_000,
      ).foundRegion,
    ).toBe(false);
  });

  it("does not promote sentence-like bold facts or ancillary self-study into project groups", () => {
    const chunk = source(
      [
        "## Independent Work — January 2021 to present",
        "**SignalDeck**, a Java event platform.",
        "- Built a concurrent event-processing core.",
        "**not an audit by a professional auditing firm**, unrelated compliance wording.",
        "**ParcelQueue Relay is used in MessageBridge Core.**, stated transaction information.",
        "**Ongoing technical research:** Tokenisation notes and self-study material.",
        "**Institutional digital assets, self-study.** Clarified research material.",
        "**HiddenProject**, Java event platform for distributed processing.",
      ].join("\n"),
    );

    const result = selectCandidateIndependentProjectEvidence(
      headingHit(chunk),
      [chunk],
      "Java concurrent event processing audit",
      "",
      4_000,
    );

    expect(result.projectDecisions).toEqual([{ title: "SignalDeck", decision: "selected" }]);
    const text = result.blocks.map(({ text: blockText }) => blockText).join("\n\n");
    expect(text).not.toContain("audit by a professional");
    expect(text).not.toContain("ParcelQueue Relay");
    expect(text).not.toContain("Institutional digital assets");
    expect(text).not.toContain("HiddenProject");
  });
});
