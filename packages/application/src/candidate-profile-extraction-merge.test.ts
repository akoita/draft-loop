import { createHash } from "node:crypto";

import { maximumCanonicalCandidateProfileProvenanceCount } from "@draft-loop/domain";
import { describe, expect, it } from "vitest";

import {
  type CanonicalCandidateProfileExtractionInput,
  processCanonicalCandidateProfileExtraction,
} from "./candidate-profile-extraction.js";

const text = [
  "Candidate-provided career history.",
  "Java",
  "java ",
  "Engineer",
  "Senior Engineer",
].join("\n");

function material(
  id: string,
  sourceId: string,
): CanonicalCandidateProfileExtractionInput["sources"][number] {
  return {
    id,
    mediaType: "text/markdown",
    checksum: createHash("sha256").update(id).digest("hex"),
    text,
    reference: {
      storeId: "store-1",
      knowledgeBaseId: "knowledge-1",
      sourceId,
      versionId: "version-1",
      kind: "candidate-provided",
    },
  };
}

function skill(key: string, value: string, sourceId: string, quote = value.trim()) {
  return {
    key,
    category: "skill",
    subjectKey: "skills",
    field: "name",
    value,
    evidence: [{ sourceId, quote }],
  };
}

async function derive(
  proposal: { facts: unknown[]; issues?: unknown[] },
  sources = [material("source-a", "source-1"), material("source-b", "source-2")],
) {
  return processCanonicalCandidateProfileExtraction(
    { extract: async () => ({ schemaVersion: 1, issues: [], ...proposal }) },
    { operationId: "profile-operation", sources, allowProviderData: true },
  );
}

describe("canonical candidate profile fact merging", () => {
  it("merges the same skill found in two sources without a duplicate warning", async () => {
    const result = await derive({
      facts: [skill("a", "Java", "source-a"), skill("b", "java", "source-b")],
    });
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]?.value).toBe("Java");
    expect(result.facts[0]?.provenance.map((item) => item.sourceId)).toEqual([
      "source-1",
      "source-2",
    ]);
    expect(result.issues.some((issue) => issue.code === "duplicate")).toBe(false);
  });

  it("still raises a conflict for different values of the same non-collection field", async () => {
    const title = (key: string, value: string, sourceId: string) => ({
      key,
      category: "role",
      subjectKey: "employment-1",
      field: "title",
      value,
      evidence: [{ sourceId, quote: value }],
    });
    const result = await derive({
      facts: [
        title("a", "Engineer", "source-a"),
        title("b", "Engineer", "source-b"),
        title("c", "Senior Engineer", "source-a"),
      ],
    });
    expect(result.facts).toHaveLength(2);
    expect(result.issues.filter((issue) => issue.code === "conflict-title")).toHaveLength(1);
    expect(result.issues.some((issue) => issue.code === "duplicate")).toBe(false);
  });

  it("does not raise a conflict for different collection facts, only merges identical ones", async () => {
    const result = await derive({
      facts: [
        skill("a", "Java", "source-a"),
        skill("b", "Java", "source-b"),
        skill("c", "Engineer", "source-a"),
      ],
    });
    expect(result.facts).toHaveLength(2);
    expect(result.issues.some((issue) => issue.code.startsWith("conflict-"))).toBe(false);
    expect(result.issues.some((issue) => issue.code === "duplicate")).toBe(false);
  });

  it("resolves proposed issues that reference a merged fact key to the survivor", async () => {
    const result = await derive({
      facts: [skill("a", "Java", "source-a"), skill("b", "Java", "source-b")],
      issues: [{ code: "duplicate", factKeys: ["a", "b"], sourceIds: ["source-a"] }],
    });
    const survivor = result.facts[0];
    const proposed = result.issues.filter((issue) => issue.code === "duplicate");
    expect(proposed).toHaveLength(1);
    expect(proposed[0]?.factIds).toEqual([survivor?.id]);
  });

  it("keeps facts separate and warns when the provenance union would exceed the cap", async () => {
    const count = maximumCanonicalCandidateProfileProvenanceCount;
    const sources = Array.from({ length: count + 1 }, (_, index) =>
      material(`source-${index}`, `ref-${index}`),
    );
    const evidenceFor = (ids: number[]) =>
      ids.map((index) => ({ sourceId: `source-${index}`, quote: "Java" }));
    const wide = (key: string, ids: number[]) => ({
      ...skill(key, "Java", "source-0"),
      evidence: evidenceFor(ids),
    });
    const result = await derive(
      {
        facts: [
          wide(
            "a",
            Array.from({ length: count }, (_, index) => index),
          ),
          wide("b", [count]),
        ],
      },
      sources,
    );
    expect(result.facts).toHaveLength(2);
    expect(result.issues.filter((issue) => issue.code === "duplicate")).toHaveLength(1);
  });
});
