import {
  type CanonicalCandidateProfileExtractionProposal,
  type CanonicalCandidateProfileProvenanceReference,
  canonicalCandidateProfileExtractionProposalSchema,
} from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";
import {
  assertCanonicalProfileEvidenceGrounded,
  CandidateProfileGroundingError,
} from "./candidate-profile-grounding-diagnostics.js";

const reference: CanonicalCandidateProfileProvenanceReference = {
  storeId: "store-1",
  knowledgeBaseId: "knowledge-1",
  sourceId: "source-1",
  versionId: "version-1",
  kind: "candidate-provided",
};

function proposal(
  evidence: readonly { readonly sourceId: string; readonly quote: string }[],
  issueSourceIds: readonly string[] = [],
) {
  return canonicalCandidateProfileExtractionProposalSchema.parse({
    schemaVersion: 1,
    facts:
      evidence.length === 0
        ? []
        : [
            {
              key: "fact-1",
              category: "role",
              field: "title",
              value: "engineer",
              evidence,
            },
          ],
    issues: [{ code: "omission", factKeys: [], sourceIds: issueSourceIds }],
  });
}

describe("candidate profile grounding diagnostics", () => {
  it("counts all failures without including cited content or source identity", () => {
    let caught: unknown;
    try {
      assertCanonicalProfileEvidenceGrounded(
        proposal(
          [
            { sourceId: "unknown-evidence", quote: "PRIVATE quote" },
            { sourceId: "missing-text", quote: "PRIVATE quote" },
            { sourceId: "known", quote: "Not present" },
            { sourceId: "known", quote: "A company" },
          ],
          ["unknown-issue", "missing-issue-text"],
        ),
        new Map([
          ["known", [reference]],
          ["missing-text", [reference]],
          ["missing-issue-text", [reference]],
        ]),
        new Map([["known", "A Engineer led the team."]]),
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(CandidateProfileGroundingError);
    expect(caught).toMatchObject({
      diagnosticCounts: [
        { code: "unknown_source", count: 4 },
        { code: "quote_not_in_source", count: 2 },
        { code: "value_not_in_quote", count: 2 },
      ],
    });
    const errorText = JSON.stringify(caught);
    expect(errorText).not.toContain("PRIVATE quote");
    expect(errorText).not.toContain("unknown-evidence");
    expect(errorText).not.toContain("Not present");
  });

  it("uses the extraction validator's normalized text matching", () => {
    expect(() =>
      assertCanonicalProfileEvidenceGrounded(
        proposal([{ sourceId: "known", quote: " A   Engineer led " }]),
        new Map([["known", [reference]]]),
        new Map([["known", "Ａ Engineer\tled the team."]]),
      ),
    ).not.toThrow();
  });

  it("treats empty quotes and values as unsupported evidence", () => {
    const emptyProposal = {
      schemaVersion: 1,
      facts: [
        {
          key: "fact-1",
          category: "role",
          field: "title",
          value: "",
          evidence: [{ sourceId: "known", quote: "" }],
        },
      ],
      issues: [],
    } as unknown as CanonicalCandidateProfileExtractionProposal;
    let caught: unknown;
    try {
      assertCanonicalProfileEvidenceGrounded(
        emptyProposal,
        new Map([["known", [reference]]]),
        new Map([["known", "source text"]]),
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({
      diagnosticCounts: [
        { code: "quote_not_in_source", count: 1 },
        { code: "value_not_in_quote", count: 1 },
      ],
    });
  });

  it("counts unknown proposal issue sources as unknown-source failures", () => {
    let caught: unknown;
    try {
      assertCanonicalProfileEvidenceGrounded(
        proposal([], ["missing-issue-source"]),
        new Map(),
        new Map(),
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ diagnosticCounts: [{ code: "unknown_source", count: 1 }] });
  });
});
