import type { ScoredEvidenceChunk } from "@draft-loop/domain";
import { describe, expect, it } from "vitest";

import { proposalIssues } from "./author-diagnostic-counts.js";
import { buildAuthorArtifact } from "./author-output.js";
import {
  authorRevisionProposal,
  buildAuthorRevisionReport,
  maxAuthorRevisionReportItems,
  maxAuthorRevisionTextCharacters,
} from "./author-revision-report.js";

function chunk(id: string, text: string, rank = 0): ScoredEvidenceChunk {
  return {
    id,
    workspaceId: "workspace",
    sourceId: "source",
    ordinal: rank,
    lineStart: rank + 1,
    lineEnd: rank + 1,
    checksum: "b".repeat(64),
    text,
    rank,
  };
}

interface ClaimInput {
  readonly text: string;
  readonly evidenceChunkIds: readonly string[];
}

function proposal(blockText: string, claims: readonly ClaimInput[]) {
  return {
    sections: [
      {
        title: "Experience",
        kind: "experience",
        blocks: [
          {
            type: "paragraph",
            text: blockText,
            claims: claims.map((claim) => ({ ...claim, substantive: true })),
          },
        ],
      },
    ],
  };
}

/** Validate the proposal for real and report its rejection. */
function report(value: unknown, retrievedEvidence: readonly ScoredEvidenceChunk[]) {
  const inputs = {
    proposal: value,
    executionId: "execution",
    context: {
      language: "en",
      evidenceManifest: [{ id: "source", path: "/private/resume.md", checksum: "a".repeat(64) }],
    },
    retrievedEvidence,
  };
  let error: unknown;
  try {
    buildAuthorArtifact(inputs);
  } catch (caught) {
    error = caught;
  }
  if (error === undefined) throw new Error("Expected the proposal to be rejected.");
  return buildAuthorRevisionReport(inputs, proposalIssues(error));
}

describe("author revision report", () => {
  it("names each protected value a claim uses without cited support", () => {
    const evidence = [chunk("cited", "Led the Northwind Freight platform in 2021.")];
    const text = "Led the Northwind Freight platform in 2023.";
    const items = report(proposal(text, [{ text, evidenceChunkIds: ["cited"] }]), evidence);

    expect(items).toContainEqual({
      path: "sections.0.blocks.0.claims.0.text",
      code: "factual_invariant_violation",
      text,
      problems: ['protected value "2023" is not stated in cited evidence'],
    });
  });

  it("says when cited evidence does not relate to the claim", () => {
    const evidence = [chunk("cited", "Built TypeScript tools.")];
    const text = "Improved warehouse throughput.";
    const items = report(proposal(text, [{ text, evidenceChunkIds: ["cited"] }]), evidence);

    expect(items).toContainEqual({
      path: "sections.0.blocks.0.claims.0.evidenceChunkIds",
      code: "unsupported_claim",
      text,
      problems: ["the cited evidence does not relate to this claim"],
    });
  });

  it("says when a substantive claim cites no evidence", () => {
    const evidence = [chunk("cited", "Built TypeScript tools.")];
    const text = "Improved warehouse throughput.";
    const items = report(proposal(text, [{ text, evidenceChunkIds: [] }]), evidence);

    expect(items).toContainEqual({
      path: "sections.0.blocks.0.claims.0.evidenceChunkIds",
      code: "missing_evidence",
      text,
      problems: ["this substantive claim cites no evidence"],
    });
  });

  it("lists ungrounded words, values, and the date ranges the cited evidence states", () => {
    const evidence = [
      chunk("cited", "Engineer, January 2019 to March 2021. Built TypeScript tools."),
      chunk("other", "Worked on logistics software."),
    ];
    const blockText = "Engineer at Contoso, Jan 2019 - Mar 2022. Built TypeScript tools.";
    const items = report(
      proposal(blockText, [{ text: "Built TypeScript tools", evidenceChunkIds: ["cited"] }]),
      evidence,
    );
    const item = items.find((entry) => entry.code === "substantive_text_uncovered");

    expect(item).toMatchObject({ path: "sections.0.blocks.0.text", text: blockText });
    expect(item?.problems).toEqual(
      expect.arrayContaining([
        'text outside substantive claims uses words found in no retrieved evidence: "contoso", "jan", "mar", "2022"',
        `protected value "Contoso" is not stated in the evidence cited by this block's claims`,
        'date range "Jan 2019 - Mar 2022" is not stated in cited evidence; cited evidence states: "January 2019 to March 2021"',
      ]),
    );
  });

  it("lists every retrieved date range when the block cites no evidence", () => {
    const evidence = [
      chunk("first", "Engineer, January 2019 to March 2021."),
      chunk("second", "Analyst, 2015 - 2018."),
    ];
    const items = report(proposal("Led platform work, Jan 2019 - Mar 2022.", []), evidence);
    const problems = items.flatMap((entry) => entry.problems);

    expect(problems).toContain(
      'date range "Jan 2019 - Mar 2022" is not stated in cited evidence; no claim in this block cites evidence for it; retrieved evidence states: "January 2019 to March 2021", "2015 - 2018"',
    );
  });

  it("names the code for other issues and keeps text of unparsable proposals", () => {
    const items = buildAuthorRevisionReport(
      { proposal: { sections: "Private heading" }, retrievedEvidence: [] },
      [
        { code: "invalid_type", path: ["sections"], message: "Expected array" },
        {
          code: "custom",
          path: ["sections"],
          message: "required section omits content established by retrieved candidate evidence",
          params: { invariantCode: "required_section_evidence_omitted" },
        },
      ],
    );

    expect(items).toEqual([
      {
        path: "sections",
        code: "invalid_type",
        text: "Private heading",
        problems: ['failed the "invalid_type" check: Expected array'],
      },
      {
        path: "sections",
        code: "required_section_evidence_omitted",
        text: "Private heading",
        problems: [
          'failed the "required_section_evidence_omitted" check: required section omits content established by retrieved candidate evidence',
        ],
      },
    ]);
  });

  it("bounds the number of items and truncates quoted text", () => {
    const longText = `Improved warehouse throughput ${"again ".repeat(200)}`;
    const issues = Array.from({ length: maxAuthorRevisionReportItems + 4 }, () => ({
      code: "custom",
      path: ["sections", 0, "blocks", 0, "claims", 0, "evidenceChunkIds"],
      message: "cited evidence does not support the CV claim",
      params: { invariantCode: "unsupported_claim" },
    }));
    const items = buildAuthorRevisionReport(
      {
        proposal: proposal(longText, [{ text: longText, evidenceChunkIds: ["cited"] }]),
        retrievedEvidence: [chunk("cited", "Built TypeScript tools.")],
      },
      issues,
    );

    expect(items).toHaveLength(maxAuthorRevisionReportItems);
    for (const item of items) {
      expect(item.text).toHaveLength(maxAuthorRevisionTextCharacters);
      expect(item.text.endsWith("…")).toBe(true);
    }
  });

  it("sends the completed proposal that report paths index into", () => {
    const raw = proposal("Built reliable TypeScript tools across regulated industries.", [
      { text: "Built reliable TypeScript tools.", evidenceChunkIds: ["cited"] },
    ]);
    const evidence = [
      chunk("cited", "Built reliable TypeScript tools across regulated industries."),
    ];

    const completed = authorRevisionProposal({ proposal: raw, retrievedEvidence: evidence });

    expect(completed).not.toBe(raw);
    expect(
      (completed as ReturnType<typeof proposal>).sections[0]?.blocks[0]?.claims.map(
        (claim) => claim.text,
      ),
    ).toEqual([
      "Built reliable TypeScript tools.",
      "Built reliable TypeScript tools across regulated industries.",
    ]);
  });

  it("falls back to the raw proposal when it does not parse", () => {
    const raw = { sections: "not a list" };

    expect(authorRevisionProposal({ proposal: raw, retrievedEvidence: [] })).toBe(raw);
  });
});
