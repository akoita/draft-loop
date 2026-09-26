import type { ScoredEvidenceChunk } from "@draft-loop/domain";
import { type AuthorArtifactProposal, authorArtifactProposalSchema } from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";

import { uncoveredBlockTokens } from "./claim-coverage.js";
import { completeCvProposalIssues } from "./complete-cv.js";

interface TestClaim {
  readonly text: string;
  readonly evidenceChunkIds: readonly string[];
}

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

function proposalWithClaims(text: string, claims: readonly TestClaim[]): AuthorArtifactProposal {
  return authorArtifactProposalSchema.parse({
    sections: [
      {
        title: "Experience",
        kind: "experience",
        blocks: [
          {
            type: "paragraph",
            text,
            claims: claims.map((claim) => ({
              text: claim.text,
              substantive: true,
              evidenceChunkIds: claim.evidenceChunkIds,
            })),
          },
        ],
      },
    ],
  });
}

function issues(
  text: string,
  evidenceChunkIds: readonly string[],
  evidence: readonly ScoredEvidenceChunk[],
  claims: readonly TestClaim[] = [{ text, evidenceChunkIds }],
): ReturnType<typeof completeCvProposalIssues> {
  return completeCvProposalIssues(proposalWithClaims(text, claims), evidence);
}

function issueCodes(
  text: string,
  evidenceChunkIds: readonly string[],
  evidence: readonly ScoredEvidenceChunk[],
  claims?: readonly TestClaim[],
): readonly string[] {
  return issues(text, evidenceChunkIds, evidence, claims).map((issue) => issue.code);
}

const northstar = chunk("northstar", "Northstar | Jan 2020 to May 2022");
const lumen = chunk("lumen", "Lumen | Jun 2022 to Jun 2024", 1);

describe("date ranges in substantive claims", () => {
  it("rejects a claimed range that merges dates from two cited employer chunks", () => {
    expect(
      issueCodes("Lumen | Jan 2020 - Jun 2024", ["northstar", "lumen"], [northstar, lumen]),
    ).toEqual(["factual_invariant_violation"]);
  });

  it("accepts a complete range stated in one cited chunk", () => {
    expect(issueCodes("Lumen | Jun 2022 - Jun 2024", ["lumen"], [northstar, lumen])).toEqual([]);
  });

  it("rejects endpoints that appear separately inside one cited chunk", () => {
    const splitEndpoints = chunk("split", "Lumen | Jan 2020; Jun 2024");

    expect(issueCodes("Lumen | Jan 2020 - Jun 2024", ["split"], [splitEndpoints])).toEqual([
      "factual_invariant_violation",
    ]);
  });

  it("does not use a complete range from an uncited chunk", () => {
    const citedFragments = chunk("fragments", "Lumen | Jan 2020; Jun 2024");
    const uncitedRange = chunk("uncited", "Lumen | Jan 2020 to Jun 2024", 1);

    expect(
      issueCodes("Lumen | Jan 2020 - Jun 2024", ["fragments"], [citedFragments, uncitedRange]),
    ).toEqual(["factual_invariant_violation"]);
  });

  it("rejects a fully covered block whose endpoints are separate substantive claims", () => {
    const endpointEvidence = [
      chunk("employer", "Lumen"),
      chunk("start", "Jan 2020", 1),
      chunk("end", "Jun 2024", 2),
    ];
    const proposal = proposalWithClaims("Lumen | Jan 2020 - Jun 2024", [
      { text: "Lumen", evidenceChunkIds: ["employer"] },
      { text: "Jan 2020", evidenceChunkIds: ["start"] },
      { text: "Jun 2024", evidenceChunkIds: ["end"] },
    ]);
    const section = proposal.sections[0];
    const block = section?.blocks[0];
    if (section === undefined || block === undefined) {
      throw new Error("experience block is missing");
    }
    expect(uncoveredBlockTokens(section, block)).toEqual([]);

    const result = completeCvProposalIssues(proposal, endpointEvidence);

    expect(result.map((issue) => issue.code)).toEqual(["factual_invariant_violation"]);
    expect(result[0]?.path).toEqual(["sections", 0, "blocks", 0, "text"]);
    expect(result[0]?.message).toContain("date range");
  });

  it("accepts a block range supported by one cited chunk across separate claims", () => {
    const header = chunk("header", "Lumen | Jun 2022 to Jun 2024");

    expect(
      issueCodes(
        "Lumen | Jun 2022 - Jun 2024",
        ["header"],
        [header],
        [
          { text: "Lumen", evidenceChunkIds: ["header"] },
          { text: "Jun 2022", evidenceChunkIds: ["header"] },
          { text: "Jun 2024", evidenceChunkIds: ["header"] },
        ],
      ),
    ).toEqual([]);
  });

  it("normalizes month abbreviations and dash-to separators", () => {
    const evidence = chunk("normalized", "Lumen | January 2020 — June 2024");

    expect(issueCodes("Lumen | Jan. 2020 to Jun. 2024", ["normalized"], [evidence])).toEqual([]);
  });

  it("accepts a year-only range supported by a complete cited range", () => {
    const evidence = chunk("year-range", "Lumen | June 2022 to March 2024");

    expect(issueCodes("Lumen | 2022 - 2024", ["year-range"], [evidence])).toEqual([]);
  });
});
