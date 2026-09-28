import {
  type CandidateKnowledgeLexicalChunkInput,
  type CandidateKnowledgeLexicalHit,
  createCandidateKnowledgeLexicalHit,
} from "@draft-loop/domain";
import { describe, expect, it } from "vitest";
import { composeCandidateRequiredSectionBodyEvidence } from "./candidate-required-section-body-evidence.js";

const provenance = {
  storeId: "store-fictional",
  knowledgeBaseId: "knowledge-fictional",
  sourceId: "source-fictional",
  versionId: "version-fictional",
};

function chunk(
  chunkId: string,
  ordinal: number,
  text: string,
  lineStart: number,
  source = provenance,
): CandidateKnowledgeLexicalChunkInput {
  return {
    chunkId,
    ordinal,
    lineStart,
    lineEnd: lineStart + text.split(/\r?\n/u).length - 1,
    text,
    metadata: { provenance: source },
  };
}

function hit(value: CandidateKnowledgeLexicalChunkInput): CandidateKnowledgeLexicalHit {
  return createCandidateKnowledgeLexicalHit({ ...value, bm25Rank: 0 });
}

describe("candidate required-section body evidence", () => {
  it("joins a marked Training heading to a body without the section token and stops at the next section", () => {
    const heading = chunk("training-heading", 0, "<!-- evidence-id: training -->\n## Training", 10);
    const body = chunk("training-body", 1, "Completed the Stream Processing Workshop in 2024.", 13);
    const nextSection = chunk(
      "languages-heading",
      2,
      "<!-- evidence-id: languages -->\n## Languages",
      15,
    );
    const nextBody = chunk("languages-body", 3, "English — fluent.", 18);
    const source = [heading, body, nextSection, nextBody];

    const composed = composeCandidateRequiredSectionBodyEvidence(
      "Certifications",
      hit(heading),
      source,
    );
    const repeated = composeCandidateRequiredSectionBodyEvidence(
      "Certifications",
      hit(heading),
      source,
    );

    expect(composed?.text).toBe("## Training\n\nCompleted the Stream Processing Workshop in 2024.");
    expect(composed?.text).not.toContain("evidence-id");
    expect(composed?.text).not.toContain("English");
    expect(composed?.lineStart).toBe(11);
    expect(composed?.lineEnd).toBe(13);
    expect(composed?.metadata.provenance).toEqual(provenance);
    expect(repeated?.chunkId).toBe(composed?.chunkId);
  });

  it("does not treat a bare heading or a body from another source version as section content", () => {
    const heading = chunk("training-heading", 0, "<!-- evidence-id: training -->\n## Training", 1);
    const nextSection = chunk("languages-heading", 1, "## Languages", 4);
    const foreignBody = chunk(
      "foreign-training-body",
      1,
      "Completed the Stream Processing Workshop.",
      3,
      { ...provenance, versionId: "another-version" },
    );

    expect(
      composeCandidateRequiredSectionBodyEvidence("Certifications", hit(heading), [
        heading,
        nextSection,
      ]),
    ).toBeUndefined();
    expect(
      composeCandidateRequiredSectionBodyEvidence("Certifications", hit(heading), [
        heading,
        foreignBody,
        nextSection,
      ]),
    ).toBeUndefined();
  });

  it("fails closed when the complete required body exceeds the retrieval text bound", () => {
    const heading = chunk("training-heading", 0, "<!-- evidence-id: training -->\n## Training", 1);
    const body = chunk("training-body", 1, `Workshop record ${"x".repeat(4_000)}`, 4);

    expect(() =>
      composeCandidateRequiredSectionBodyEvidence("Certifications", hit(heading), [heading, body]),
    ).toThrow("Required-section evidence exceeded its bounded record size.");
  });
});
