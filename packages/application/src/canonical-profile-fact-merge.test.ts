import type { CanonicalCandidateProfileFact } from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";

import { mergeIdenticalProfileFacts } from "./canonical-profile-fact-merge.js";

function reference(sourceId: string) {
  return {
    storeId: "store-1",
    knowledgeBaseId: "knowledge-1",
    sourceId,
    versionId: "version-1",
    kind: "candidate-provided" as const,
  };
}

function fact(
  id: string,
  value: string,
  sourceIds: readonly string[],
  overrides: Partial<CanonicalCandidateProfileFact> = {},
): CanonicalCandidateProfileFact {
  return {
    id,
    category: "skill",
    field: "Name",
    value,
    provenance: sourceIds.map(reference),
    ...overrides,
  };
}

describe("mergeIdenticalProfileFacts", () => {
  it("merges identical facts into the first one with the union of provenance", () => {
    const result = mergeIdenticalProfileFacts(
      [fact("a", "Java", ["s2"]), fact("b", "Rust", ["s1"]), fact("c", "Java", ["s3", "s1"])],
      8,
    );
    expect(result.facts.map((item) => item.id)).toEqual(["a", "b"]);
    expect(result.facts[0]?.provenance.map((item) => item.sourceId)).toEqual(["s1", "s2", "s3"]);
    expect([...result.aliasOf]).toEqual([["c", "a"]]);
  });

  it("matches case, whitespace, and Unicode-normalized values and keeps survivor text", () => {
    const result = mergeIdenticalProfileFacts(
      [
        fact("a", "Machine Learning", ["s1"]),
        fact("b", "  machine   learning ", ["s2"]),
        fact("c", "MACHINE LEARNING", ["s3"], { field: " name " }),
      ],
      8,
    );
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]).toMatchObject({ id: "a", value: "Machine Learning", field: "Name" });
    expect(result.facts[0]?.provenance).toHaveLength(3);
  });

  it("does not merge across categories, subjects, fields, or values", () => {
    const result = mergeIdenticalProfileFacts(
      [
        fact("a", "Java", ["s1"]),
        fact("b", "Java", ["s1"], { category: "project" }),
        fact("c", "Java", ["s1"], { subjectId: "subject-1" }),
        fact("d", "Java", ["s1"], { field: "Other" }),
        fact("e", "Javas", ["s1"]),
      ],
      8,
    );
    expect(result.facts).toHaveLength(5);
    expect(result.aliasOf.size).toBe(0);
  });

  it("leaves facts separate when the provenance union would exceed the cap", () => {
    const result = mergeIdenticalProfileFacts(
      [fact("a", "Java", ["s1", "s2"]), fact("b", "Java", ["s3"]), fact("c", "Java", ["s2"])],
      2,
    );
    expect(result.facts.map((item) => item.id)).toEqual(["a", "b"]);
    expect(result.facts[0]?.provenance.map((item) => item.sourceId)).toEqual(["s1", "s2"]);
    expect([...result.aliasOf]).toEqual([["c", "a"]]);
  });

  it("is deterministic and does not mutate its input", () => {
    const input = [fact("a", "Java", ["s1"]), fact("b", "Java", ["s2"])];
    const snapshot = structuredClone(input);
    expect(mergeIdenticalProfileFacts(input, 8)).toEqual(mergeIdenticalProfileFacts(input, 8));
    expect(input).toEqual(snapshot);
  });
});
