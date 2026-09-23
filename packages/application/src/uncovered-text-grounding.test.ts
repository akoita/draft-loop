import type { ScoredEvidenceChunk } from "@draft-loop/domain";
import { type AuthorArtifactProposal, authorArtifactProposalSchema } from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";

import { completeCvProposalIssues } from "./complete-cv.js";
import { hasUnsupportedDateRange } from "./uncovered-text-grounding.js";

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

const cited = chunk("cited", "Reduced processing time by 25 percent at Northwind Freight in 2021.");
const claim = "Reduced processing time by 25 percent";

function proposal(
  blockText: string,
  claimTexts: readonly string[],
  citedIds: readonly string[] = ["cited"],
): AuthorArtifactProposal {
  return authorArtifactProposalSchema.parse({
    sections: [
      {
        title: "Experience",
        kind: "experience",
        blocks: [
          {
            type: "paragraph",
            text: blockText,
            claims: claimTexts.map((text) => ({
              text,
              substantive: true,
              evidenceChunkIds: citedIds,
            })),
          },
        ],
      },
    ],
  });
}

function codes(input: AuthorArtifactProposal, evidence: readonly ScoredEvidenceChunk[]) {
  return completeCvProposalIssues(input, evidence).map((issue) => issue.code);
}

describe("uncovered block text grounding", () => {
  it.each([
    "Reduced processing time by 25 percent, which was at Northwind Freight in 2021.",
    "In 2021, it reduced processing time by 25 percent",
  ])("accepts function words and evidence words outside claims: %s", (blockText) => {
    expect(codes(proposal(blockText, [claim]), [cited])).toEqual([]);
  });

  it.each([
    ["an invented verb", "Reduced processing time by 25 percent and doubled it."],
    ["an invented noun", "Reduced processing time by 25 percent for customers."],
    ["an invented date", "Reduced processing time by 25 percent in 2017."],
    ["an invented metric", "Reduced processing time by 25 percent, then 40 percent."],
    ["an invented employer", "Reduced processing time by 25 percent at Globex."],
    ["an invented name", "Reduced processing time by 25 percent using Kafka."],
  ])("rejects text outside claims that introduces %s", (_case, blockText) => {
    expect(completeCvProposalIssues(proposal(blockText, [claim]), [cited])).toEqual([
      {
        code: "substantive_text_uncovered",
        path: ["sections", 0, "blocks", 0, "text"],
        message: "text outside substantive claims introduces a fact absent from evidence",
      },
    ]);
  });

  it("rejects a date range whose end year appears only in an uncited chunk", () => {
    const evidence = [
      chunk("cited", "Staff Engineer, Northwind Freight (2019 – 2024)."),
      chunk("uncited", "Promoted to Staff Engineer in 2023.", 1),
    ];

    expect(
      codes(
        proposal("Staff Engineer | Northwind Freight | 2019 – 2023", ["Staff Engineer"]),
        evidence,
      ),
    ).toEqual(["substantive_text_uncovered"]);
  });

  describe("date ranges outside claims", () => {
    const heading = "Staff Engineer | Northwind Freight | 2019 – 2023";

    it("accepts a range stated in one cited chunk", () => {
      const evidence = [chunk("cited", "Staff Engineer, Northwind Freight (2019 – 2023).")];

      expect(codes(proposal(heading, ["Staff Engineer"]), evidence)).toEqual([]);
    });

    it("rejects an end year found only as a separate year in another cited chunk", () => {
      const evidence = [
        chunk("cited", "Staff Engineer, Northwind Freight (2019 – 2024)."),
        chunk("promotion", "Promoted to Staff Engineer in 2023.", 1),
      ];

      expect(
        codes(proposal(heading, ["Staff Engineer"], ["cited", "promotion"]), evidence),
      ).toEqual(["substantive_text_uncovered"]);
    });

    it("accepts an en dash in the block against a hyphen in the evidence", () => {
      const evidence = [chunk("cited", "Staff Engineer, Northwind Freight (2019-2023).")];

      expect(codes(proposal(heading, ["Staff Engineer"]), evidence)).toEqual([]);
    });

    it("rejects an open range in the block against a closing year in the evidence", () => {
      const evidence = [chunk("cited", "Staff Engineer, Northwind Freight (2019 – 2023).")];

      expect(
        codes(
          proposal("Staff Engineer | Northwind Freight | 2019 – Present", ["Staff Engineer"]),
          evidence,
        ),
      ).toEqual(["substantive_text_uncovered"]);
    });

    it.each([
      ["Jan 2019 to Mar 2023", ["January 2019 – March 2023"], false],
      ["2019 — 2023", ["Mar 2019 - Jun 2023"], false],
      ["Feb 2019 - 2023", ["Mar 2019 - 2023"], true],
      ["2019 to current", ["2019 - now"], false],
      ["2019 - 2023", ["2019", "2023"], true],
      ["2019 - 2023", [], true],
    ])("compares %s against %j", (text, evidence, unsupported) => {
      expect(hasUnsupportedDateRange(text, evidence)).toBe(unsupported);
    });
  });

  it("accepts a skill word outside claims that only an uncited retrieved chunk contains", () => {
    const input = proposal("Reduced processing time by 25 percent with observability", [claim]);

    expect(
      codes(input, [cited, chunk("uncited", "Introduced observability dashboards.", 1)]),
    ).toEqual([]);
    expect(codes(input, [cited])).toEqual(["substantive_text_uncovered"]);
  });

  it("keeps claim-level checks limited to cited evidence", () => {
    const evidence = [cited, chunk("uncited", "Operated Kafka clusters for 12 teams.", 1)];

    expect(
      codes(
        proposal("Reduced processing time by 40 percent.", [
          "Reduced processing time by 40 percent.",
        ]),
        evidence,
      ),
    ).toEqual(["factual_invariant_violation"]);
    expect(
      codes(proposal("Operated Kafka clusters.", ["Operated Kafka clusters."]), evidence),
    ).toEqual(["unsupported_claim", "factual_invariant_violation"]);
  });
});
