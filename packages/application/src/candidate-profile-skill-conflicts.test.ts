import { describe, expect, it } from "vitest";

import {
  type CanonicalCandidateProfileExtractionInput,
  processCanonicalCandidateProfileExtraction,
} from "./candidate-profile-extraction.js";

const checksumA = "a".repeat(64);

function material(
  id: string,
  text: string,
  checksum = checksumA,
): CanonicalCandidateProfileExtractionInput["sources"][number] {
  return {
    id,
    mediaType: "text/plain",
    checksum,
    text,
    reference: {
      storeId: `store-${id}`,
      knowledgeBaseId: `knowledge-${id}`,
      sourceId: `document-${id}`,
      versionId: `version-${id}`,
      kind: "candidate-provided",
    },
  };
}

function skillFact(
  key: string,
  value: string,
  sourceId: string,
  subjectKey?: string,
  field = "name",
) {
  return {
    key,
    category: "skill",
    ...(subjectKey === undefined ? {} : { subjectKey }),
    field,
    value,
    evidence: [{ sourceId, quote: value }],
  };
}

async function extract(
  sources: readonly CanonicalCandidateProfileExtractionInput["sources"][number][],
  facts: readonly ReturnType<typeof skillFact>[],
  issues: readonly {
    readonly code: string;
    readonly factKeys: string[];
    readonly sourceIds: string[];
  }[] = [],
) {
  return processCanonicalCandidateProfileExtraction(
    { extract: async () => ({ schemaVersion: 1, facts, issues }) },
    { operationId: "skill-conflicts", sources, allowProviderData: true },
  );
}

describe("canonical candidate profile skill conflict detection", () => {
  it("keeps distinct unscoped skills without an automatic differing-value conflict", async () => {
    const first = material("source-a", "TypeScript");
    const second = material("source-b", "React");
    const result = await extract(
      [first, second],
      [skillFact("typescript", "TypeScript", first.id), skillFact("react", "React", second.id)],
    );

    expect(result.facts.map((fact) => fact.value)).toEqual(["TypeScript", "React"]);
    expect(result.facts.map((fact) => fact.provenance[0]?.sourceId)).toEqual([
      first.reference.sourceId,
      second.reference.sourceId,
    ]);
    expect(result.issues.some((issue) => issue.code === "conflict-value")).toBe(false);
  });

  it("merges equal unscoped skill values from distinct sources into one fact", async () => {
    const first = material("source-a", "TypeScript");
    const second = material("source-b", "TypeScript", "b".repeat(64));
    const result = await extract(
      [first, second],
      [
        skillFact("typescript-a", "TypeScript", first.id),
        skillFact("typescript-b", "TypeScript", second.id),
      ],
    );

    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]?.provenance).toMatchObject([first.reference, second.reference]);
    expect(result.issues.some((issue) => issue.code === "duplicate")).toBe(false);
    expect(result.issues.some((issue) => issue.code === "conflict-value")).toBe(false);
  });

  it("keeps differing skill collection values even when they share a subject", async () => {
    const first = material("source-a", "TypeScript");
    const second = material("source-b", "React");
    const result = await extract(
      [first, second],
      [
        skillFact("skill-a", "TypeScript", first.id, "skill-set"),
        skillFact("skill-b", "React", second.id, "skill-set"),
      ],
    );

    expect(result.facts).toHaveLength(2);
    expect(new Set(result.facts.map((fact) => fact.subjectId)).size).toBe(1);
    expect(result.issues.some((issue) => issue.code === "conflict-value")).toBe(false);
  });

  it("merges scoped skills with the same value into one fact", async () => {
    const first = material("source-a", "TypeScript");
    const second = material("source-b", "TypeScript", "b".repeat(64));
    const result = await extract(
      [first, second],
      [
        skillFact("typescript-a", "TypeScript", first.id, "skill-set"),
        skillFact("typescript-b", "TypeScript", second.id, "skill-set"),
      ],
    );

    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]?.provenance).toMatchObject([first.reference, second.reference]);
    expect(result.issues.some((issue) => issue.code === "duplicate")).toBe(false);
    expect(result.issues.some((issue) => issue.code === "conflict-value")).toBe(false);
  });

  it("preserves provider-proposed conflicts for unscoped skills", async () => {
    const first = material("source-a", "TypeScript");
    const second = material("source-b", "React");
    const additional = material("source-c", "Skills documented");
    const result = await extract(
      [first, second, additional],
      [skillFact("skill-a", "TypeScript", first.id), skillFact("skill-b", "React", second.id)],
      [
        {
          code: "conflict-value",
          factKeys: ["skill-a", "skill-b"],
          sourceIds: [first.id, second.id, additional.id],
        },
      ],
    );

    const conflicts = result.issues.filter((issue) => issue.code === "conflict-value");
    expect(result.facts).toHaveLength(2);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.sourceRefs).toEqual([
      first.reference,
      second.reference,
      additional.reference,
    ]);
  });

  it("preserves provider-proposed proficiency conflicts for scoped skills", async () => {
    const first = material("source-a", "Advanced TypeScript proficiency");
    const second = material("source-b", "Beginner TypeScript proficiency");
    const additional = material("source-c", "Skills documented");
    const result = await extract(
      [first, second, additional],
      [
        skillFact("skill-a", "Advanced", first.id, "typescript", "proficiency"),
        skillFact("skill-b", "Beginner", second.id, "typescript", "proficiency"),
      ],
      [
        {
          code: "conflict-value",
          factKeys: ["skill-a", "skill-b"],
          sourceIds: [first.id, second.id, additional.id],
        },
      ],
    );

    const conflicts = result.issues.filter((issue) => issue.code === "conflict-value");
    expect(result.facts).toHaveLength(2);
    expect(new Set(result.facts.map((fact) => fact.subjectId)).size).toBe(1);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.sourceRefs).toEqual([
      first.reference,
      second.reference,
      additional.reference,
    ]);
  });
});
