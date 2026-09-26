import type { ScoredEvidenceChunk } from "@draft-loop/domain";
import { type AuthorArtifactProposal, authorArtifactProposalSchema } from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";
import { uncoveredBlockTokens } from "./claim-coverage.js";
import { completeCvProposalIssues } from "./complete-cv.js";
import { hasUnsupportedEmployerHeaderRange } from "./employer-header-range.js";

interface TestClaim {
  readonly text: string;
  readonly evidenceChunkIds: readonly string[];
}

type ProposalSection = AuthorArtifactProposal["sections"][number];
type ProposalBlock = ProposalSection["blocks"][number];

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

function isUnsupportedHeaderRange(
  text: string,
  citedEvidenceChunks: readonly string[],
  options: {
    readonly kind?: ProposalSection["kind"];
    readonly type?: ProposalBlock["type"];
  } = {},
): boolean {
  return hasUnsupportedEmployerHeaderRange(
    { kind: options.kind ?? "experience" },
    { text, type: options.type ?? "paragraph" },
    citedEvidenceChunks,
  );
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

describe("employer-associated experience header date ranges", () => {
  it("accepts a complete range beside the employer on one cited source line", () => {
    expect(
      isUnsupportedHeaderRange("**Ｌｕｍｅｎ** | Engineer | Jan. 2022 - Jun. 2024", [
        "### **Lumen** | Backend Engineer | January 2022 — June 2024",
      ]),
    ).toBe(false);
  });

  it("does not combine an employer and career-wide range from separate cited chunks", () => {
    expect(
      isUnsupportedHeaderRange("Lumen | Jan 2020 to Jun 2024", [
        "Lumen",
        "Career overview | Jan 2020 to Jun 2024",
      ]),
    ).toBe(true);
  });

  it("does not combine an employer and range from separate lines in one chunk", () => {
    expect(
      isUnsupportedHeaderRange("Lumen | Jan 2020 to Jun 2024", [
        "Lumen\nCareer overview | Jan 2020 to Jun 2024",
      ]),
    ).toBe(true);
  });

  it("does not combine separate cited employer and range fragments", () => {
    expect(
      isUnsupportedHeaderRange("Lumen | Jan 2020 to Jun 2024", ["Lumen", "Jan 2020 to Jun 2024"]),
    ).toBe(true);
  });

  it("accepts a year-only range supported by a complete same-employer range", () => {
    expect(
      isUnsupportedHeaderRange("Lumen | 2022 - 2024", ["Lumen | June 2022 to March 2024"]),
    ).toBe(false);
  });

  it("requires the same employer for an open range ending in present", () => {
    expect(
      isUnsupportedHeaderRange("Lumen | Jan 2020 to present", [
        "Juniper | Jan 2020 to present",
        "Lumen",
      ]),
    ).toBe(true);
  });

  it("does not apply to prose, project sections, or bullet blocks", () => {
    expect(
      isUnsupportedHeaderRange("Worked at Lumen from Jan 2020 to Jun 2024", [
        "Lumen | Jan 2020 to Jun 2024",
      ]),
    ).toBe(false);
    expect(
      isUnsupportedHeaderRange("Lumen | Jan 2020 to Jun 2024", ["Lumen"], {
        kind: "projects",
      }),
    ).toBe(false);
    expect(
      isUnsupportedHeaderRange("Lumen | Jan 2020 to Jun 2024", ["Lumen"], {
        type: "bullet",
      }),
    ).toBe(false);
  });

  it("requires a whole employer token rather than a longer-name prefix", () => {
    expect(
      isUnsupportedHeaderRange("Lumen | Jan 2020 to Jun 2024", ["Lumenary | Jan 2020 to Jun 2024"]),
    ).toBe(true);
  });

  it("rejects a fully covered split-claim header without same-line employer and range evidence", () => {
    const evidence = [
      chunk("employer", "Lumen"),
      chunk("range", "Career overview | Jan 2020 to Jun 2024", 1),
    ];
    const proposal = proposalWithClaims("Lumen | Jan 2020 - Jun 2024", [
      { text: "Lumen", evidenceChunkIds: ["employer"] },
      { text: "Jan 2020", evidenceChunkIds: ["range"] },
      { text: "Jun 2024", evidenceChunkIds: ["range"] },
    ]);
    const section = proposal.sections[0];
    const block = section?.blocks[0];
    if (section === undefined || block === undefined) {
      throw new Error("experience block is missing");
    }
    expect(uncoveredBlockTokens(section, block)).toEqual([]);

    const issues = completeCvProposalIssues(proposal, evidence);

    expect(issues.map((issue) => issue.code)).toEqual(["factual_invariant_violation"]);
    expect(issues[0]?.path).toEqual(["sections", 0, "blocks", 0, "text"]);
    expect(issues[0]?.message).toContain("same-employer");
  });

  it("does not use a valid employer range from an uncited chunk", () => {
    const evidence = [
      chunk("employer", "Lumen"),
      chunk("range", "Career overview | Jan 2020 to Jun 2024", 1),
      chunk("uncited-header", "Lumen | Jan 2020 to Jun 2024", 2),
    ];
    const proposal = proposalWithClaims("Lumen | Jan 2020 - Jun 2024", [
      { text: "Lumen | Jan 2020 - Jun 2024", evidenceChunkIds: ["employer", "range"] },
    ]);

    expect(completeCvProposalIssues(proposal, evidence).map((issue) => issue.code)).toEqual([
      "factual_invariant_violation",
    ]);
  });

  it("accepts fully covered split claims when one cited line supports employer and range", () => {
    const source = chunk("header", "Lumen | Jan 2020 to Jun 2024");
    const proposal = proposalWithClaims("Lumen | Jan 2020 - Jun 2024", [
      { text: "Lumen", evidenceChunkIds: ["header"] },
      { text: "Jan 2020", evidenceChunkIds: ["header"] },
      { text: "Jun 2024", evidenceChunkIds: ["header"] },
    ]);

    expect(completeCvProposalIssues(proposal, [source])).toEqual([]);
  });
});
