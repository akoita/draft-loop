import { describe, expect, it } from "vitest";

import {
  type CanonicalCandidateProfileExtractionInput,
  processCanonicalCandidateProfileExtraction,
} from "./candidate-profile-extraction.js";

interface CredentialFactInput {
  readonly key: string;
  readonly value: string;
  readonly sourceId: string;
  readonly subjectKey?: string;
}

function credentialFact({ key, value, sourceId, subjectKey }: CredentialFactInput) {
  return {
    key,
    category: "certification" as const,
    ...(subjectKey === undefined ? {} : { subjectKey }),
    field: "certification",
    value,
    evidence: [{ sourceId, quote: value }],
  };
}

function source(id: string, value: string) {
  const suffix = id.slice(-1);
  return {
    id,
    mediaType: "text/plain",
    checksum: suffix.repeat(64),
    text: `Certification: ${value}`,
    reference: {
      storeId: `store-${suffix}`,
      knowledgeBaseId: `knowledge-${suffix}`,
      sourceId: `document-${suffix}`,
      versionId: `version-${suffix}`,
      kind: "candidate-provided" as const,
    },
  };
}

async function extract(
  sources: readonly CanonicalCandidateProfileExtractionInput["sources"][number][],
  facts: readonly ReturnType<typeof credentialFact>[],
  issues: readonly {
    readonly code: string;
    readonly factKeys: string[];
    readonly sourceIds: string[];
  }[] = [],
) {
  return processCanonicalCandidateProfileExtraction(
    {
      extract: async () => ({ schemaVersion: 1, facts, issues }),
    },
    { operationId: "certification-review", sources, allowProviderData: true },
  );
}

describe("canonical candidate certification conflict detection", () => {
  it("keeps distinct unscoped credentials without treating their values as a conflict", async () => {
    const first = source("source-a", "AWS Certified Solutions Architect");
    const second = source("source-b", "Certified Kubernetes Administrator");
    const result = await extract(
      [first, second],
      [
        credentialFact({
          key: "aws-certification",
          value: "AWS Certified Solutions Architect",
          sourceId: first.id,
        }),
        credentialFact({
          key: "kubernetes-certification",
          value: "Certified Kubernetes Administrator",
          sourceId: second.id,
        }),
      ],
    );

    expect(result.facts.map((fact) => fact.value).sort()).toEqual([
      "AWS Certified Solutions Architect",
      "Certified Kubernetes Administrator",
    ]);
    expect(result.facts.map((fact) => fact.provenance[0]?.sourceId).sort()).toEqual([
      "document-a",
      "document-b",
    ]);
    expect(result.issues.some((issue) => issue.code.startsWith("conflict-"))).toBe(false);
  });

  it("still reports equal unscoped credentials as duplicates across source references", async () => {
    const first = source("source-a", "AWS Certified Solutions Architect");
    const second = source("source-b", "AWS Certified Solutions Architect");
    const result = await extract(
      [first, second],
      [
        credentialFact({
          key: "aws-certification-a",
          value: "AWS Certified Solutions Architect",
          sourceId: first.id,
        }),
        credentialFact({
          key: "aws-certification-b",
          value: "AWS Certified Solutions Architect",
          sourceId: second.id,
        }),
      ],
    );

    expect(result.facts).toHaveLength(2);
    expect(result.issues.filter((issue) => issue.code === "duplicate")).toHaveLength(1);
    expect(result.issues.some((issue) => issue.code.startsWith("conflict-"))).toBe(false);
    expect(result.issues.find((issue) => issue.code === "duplicate")?.sourceRefs).toEqual([
      first.reference,
      second.reference,
    ]);
  });

  it("reports differing values as a conflict when the certifications share a subject", async () => {
    const first = source("source-a", "AWS Certified Solutions Architect");
    const second = source("source-b", "AWS Certified Developer");
    const result = await extract(
      [first, second],
      [
        credentialFact({
          key: "aws-certification-a",
          value: "AWS Certified Solutions Architect",
          sourceId: first.id,
          subjectKey: "same-credential",
        }),
        credentialFact({
          key: "aws-certification-b",
          value: "AWS Certified Developer",
          sourceId: second.id,
          subjectKey: "same-credential",
        }),
      ],
    );

    const conflict = result.issues.find((issue) => issue.code === "conflict-value");
    expect(result.facts).toHaveLength(2);
    expect(conflict?.factIds).toHaveLength(2);
    expect(conflict?.sourceRefs).toEqual([first.reference, second.reference]);
    expect(new Set(result.facts.map((fact) => fact.subjectId)).size).toBe(1);
  });

  it("retains provider-supplied conflicts for unscoped certification facts", async () => {
    const first = source("source-a", "AWS Certified Solutions Architect");
    const second = source("source-b", "AWS Certified Developer");
    const additional = source("source-c", "Certification records reviewed");
    const result = await extract(
      [first, second, additional],
      [
        credentialFact({
          key: "aws-certification-a",
          value: "AWS Certified Solutions Architect",
          sourceId: first.id,
        }),
        credentialFact({
          key: "aws-certification-b",
          value: "AWS Certified Developer",
          sourceId: second.id,
        }),
      ],
      [
        {
          code: "conflict-value",
          factKeys: ["aws-certification-a", "aws-certification-b"],
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
});
