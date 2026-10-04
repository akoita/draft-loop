import {
  type CanonicalCandidateProfileExtractionProposal,
  type CanonicalCandidateProfileProvenanceReference,
  canonicalCandidateProfileExtractionProposalSchema,
} from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";
import { assertCanonicalProfileEvidenceGrounded } from "./candidate-profile-grounding-diagnostics.js";
import { filterGroundedCanonicalProfileProposal } from "./canonical-profile-grounded-filter.js";

const reference: CanonicalCandidateProfileProvenanceReference = {
  storeId: "store-1",
  knowledgeBaseId: "knowledge-1",
  sourceId: "document-1",
  versionId: "version-1",
  kind: "candidate-provided",
};
const references = new Map([["source-a", [reference]]]);
const sourceTexts = new Map([["source-a", "Built Project Orion with TypeScript and React."]]);

function fact(key: string, value: string, quote = value, sourceId = "source-a", field = "name") {
  return {
    key,
    category: "skill",
    subjectKey: `subject-${key}`,
    field,
    value,
    evidence: [{ sourceId, quote }],
  };
}

function parse(
  facts: readonly object[],
  issues: readonly object[] = [],
): CanonicalCandidateProfileExtractionProposal {
  return canonicalCandidateProfileExtractionProposalSchema.parse({
    schemaVersion: 1,
    facts,
    issues,
  });
}

describe("filterGroundedCanonicalProfileProposal", () => {
  it("returns a fully grounded proposal unchanged", () => {
    const grounded = parse([fact("a", "TypeScript"), fact("b", "React")]);

    const result = filterGroundedCanonicalProfileProposal(grounded, references, sourceTexts);

    expect(result.droppedFacts).toBe(0);
    expect(result.proposal).toBe(grounded);
  });

  it("drops facts for an unknown source, a missing quote, or a value outside its quote", () => {
    const result = filterGroundedCanonicalProfileProposal(
      parse([
        fact("kept", "TypeScript"),
        fact("unknown-source", "TypeScript", "TypeScript", "source-ghost"),
        fact("missing-quote", "Rust", "Rust"),
        fact("value-outside-quote", "React", "TypeScript"),
      ]),
      references,
      sourceTexts,
    );

    expect(result.droppedFacts).toBe(3);
    expect(result.proposal.facts.map((entry) => entry.key)).toEqual(["kept"]);
  });

  it("drops a fact when any one of its evidence items is ungrounded", () => {
    const mixed = parse([
      {
        ...fact("partly-grounded", "TypeScript"),
        evidence: [
          { sourceId: "source-a", quote: "TypeScript" },
          { sourceId: "source-a", quote: "TypeScript in a claim that is not in the source" },
        ],
      },
    ]);

    const result = filterGroundedCanonicalProfileProposal(mixed, references, sourceTexts);

    expect(result.droppedFacts).toBe(1);
    expect(result.proposal.facts).toEqual([]);
  });

  it("drops issues that cite a dropped fact or an unknown source and re-parses", () => {
    const result = filterGroundedCanonicalProfileProposal(
      parse(
        [
          fact("a", "TypeScript", "TypeScript", "source-a", "title"),
          fact("b", "React", "React", "source-a", "title"),
          fact("bad", "Rust", "Rust", "source-a", "title"),
        ],
        [
          { code: "conflict-title", factKeys: ["a", "b"], sourceIds: ["source-a"] },
          { code: "conflict-title", factKeys: ["a", "bad"], sourceIds: ["source-a"] },
          { code: "omission", factKeys: ["bad"], sourceIds: [] },
          { code: "omission", factKeys: [], sourceIds: ["source-ghost"] },
          { code: "omission", factKeys: [], sourceIds: ["source-a"] },
        ],
      ),
      references,
      sourceTexts,
    );

    expect(result.droppedFacts).toBe(1);
    expect(result.proposal.issues.map((issue) => [issue.code, issue.factKeys])).toEqual([
      ["conflict-title", ["a", "b"]],
      ["omission", []],
    ]);
    expect(
      canonicalCandidateProfileExtractionProposalSchema.safeParse(result.proposal).success,
    ).toBe(true);
  });

  it("produces a proposal that passes the whole-proposal grounding assertion", () => {
    const result = filterGroundedCanonicalProfileProposal(
      parse(
        [fact("kept", "TypeScript"), fact("bad", "Rust", "Rust")],
        [{ code: "omission", factKeys: [], sourceIds: ["source-ghost"] }],
      ),
      references,
      sourceTexts,
    );

    expect(() =>
      assertCanonicalProfileEvidenceGrounded(result.proposal, references, sourceTexts),
    ).not.toThrow();
  });

  it("can drop every fact", () => {
    const result = filterGroundedCanonicalProfileProposal(
      parse([fact("bad", "Rust", "Rust")]),
      references,
      sourceTexts,
    );

    expect(result.droppedFacts).toBe(1);
    expect(result.proposal.facts).toEqual([]);
  });
});
