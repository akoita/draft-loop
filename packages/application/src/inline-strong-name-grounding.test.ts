import type { ScoredEvidenceChunk } from "@draft-loop/domain";
import { authorArtifactProposalSchema } from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";

import { completeCvProposalIssues } from "./complete-cv.js";
import { supportsInlineStrongMultiwordName } from "./inline-strong-name-grounding.js";

function source(text: string): ScoredEvidenceChunk {
  return {
    id: "source-chunk",
    workspaceId: "workspace",
    sourceId: "source",
    ordinal: 0,
    lineStart: 1,
    lineEnd: 1,
    checksum: "a".repeat(64),
    text,
    rank: 0,
  };
}

function proposal(text: string) {
  return authorArtifactProposalSchema.parse({
    sections: [
      {
        title: "Summary",
        kind: "summary",
        blocks: [
          {
            type: "paragraph",
            text,
            claims: [{ text, substantive: true, evidenceChunkIds: ["source-chunk"] }],
          },
        ],
      },
    ],
  });
}

describe("inline strong multiword name grounding", () => {
  it.each([
    ["**FLUX** RPC", "FLUX RPC"],
    ["A source documents **FLUX** **RPC** together.", "FLUX RPC"],
    ["**FLUX**\t**RPC**", "FLUX RPC"],
    ["**FLUX** RPC was built with **written in Arbor**.", "FLUX RPC"],
    ["**FLUX** RPC (Full Link Utility) was built with **written in Arbor**.", "FLUX RPC"],
    ["Rust **Driftglass Bridge** adapter", "Rust Driftglass Bridge"],
    ["Rust **Driftglass** Bridge adapter", "Rust Driftglass Bridge"],
    ["Rust Driftglass **Bridge** adapter", "Rust Driftglass Bridge"],
    ["**Rust Driftglass Bridge** adapter", "Rust Driftglass Bridge"],
  ])("matches exact same-line names with whole-word strong markers: %s", (evidence, name) => {
    expect(supportsInlineStrongMultiwordName(evidence, name)).toBe(true);
  });

  it.each([
    ["**FLUXX** RPC", "FLUX RPC"],
    ["**FLUX** systems RPC", "FLUX RPC"],
    ["**FLUX**\nRPC", "FLUX RPC"],
    ["\\**FLUX** RPC", "FLUX RPC"],
    ["**FLUX RPC", "FLUX RPC"],
    ["***FLUX*** RPC", "FLUX RPC"],
    ["Rus**t** Driftglass Bridge", "Rust Driftglass Bridge"],
    ["Rust **Driftglass**ER Bridge", "Rust Driftglass Bridge"],
    ["`**FLUX** RPC`", "FLUX RPC"],
    ["C**FLUX** RPC", "FLUX RPC"],
    ["**FLUX**ER RPC", "FLUX RPC"],
    ["**FLUX** R-P-C", "FLUX RPC"],
    ["**2020** **2021**", "2020 2021"],
    ["Rust **Driftglass Bridges** adapter", "Rust Driftglass Bridge"],
    ["Rust backend uses a **Driftglass Bridge** adapter", "Rust Driftglass Bridge"],
    ["Rust Driftglass Bridge adapter", "Rust Driftglass Bridge"],
    ["Rust Driftglass Bridge adapter and **unrelated** text", "Rust Driftglass Bridge"],
    ["Rust **Driftglass Bridge adapter", "Rust Driftglass Bridge"],
    ["Rust \\**Driftglass Bridge\\** adapter", "Rust Driftglass Bridge"],
    ["Rust `**Driftglass Bridge**` adapter", "Rust Driftglass Bridge"],
    ["Rust **Driftglass\nBridge** adapter", "Rust Driftglass Bridge"],
    ["Rust **Driftglass**\n**Bridge** adapter", "Rust Driftglass Bridge"],
  ])(
    "rejects changed, unmarked, malformed, escaped, coded, or split values: %s",
    (evidence, name) => {
      expect(supportsInlineStrongMultiwordName(evidence, name)).toBe(false);
    },
  );

  it("does not combine marked words across separate evidence chunks", () => {
    const chunks = ["Rust **Driftglass** adapter", "**Bridge** tools"];

    expect(
      chunks.some((chunk) => supportsInlineStrongMultiwordName(chunk, "Rust Driftglass Bridge")),
    ).toBe(false);
  });

  it("accepts a cited CV claim supported by a marked contiguous multiword name", () => {
    const claim = "Built Rust Driftglass Bridge adapter.";

    expect(
      completeCvProposalIssues(proposal(claim), [source("Rust **Driftglass Bridge** adapter")]),
    ).toEqual([]);
  });
});
