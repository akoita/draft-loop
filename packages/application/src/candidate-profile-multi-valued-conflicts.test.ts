import { describe, expect, it } from "vitest";

import { isCandidateProfileCollectionFact } from "./candidate-profile-collection-conflicts.js";
import {
  type CanonicalCandidateProfileExtractionInput,
  processCanonicalCandidateProfileExtraction,
  reconcileCanonicalCandidateProfileFacts,
} from "./candidate-profile-extraction.js";

const source: CanonicalCandidateProfileExtractionInput["sources"][number] = {
  id: "source-a",
  mediaType: "text/plain",
  checksum: "a".repeat(64),
  text: "Revision one\nRevision two\nRevision three\nStarted 2020\nStarted 2021",
  reference: {
    storeId: "store-a",
    knowledgeBaseId: "knowledge-a",
    sourceId: "document-a",
    versionId: "version-a",
    kind: "candidate-provided",
  },
};

let factCount = 0;

function nextFactKey(): number {
  factCount += 1;
  return factCount;
}

function fact(category: string, subjectKey: string, field: string, value: string) {
  return {
    key: `fact-${nextFactKey()}`,
    category,
    subjectKey,
    field,
    value,
    evidence: [{ sourceId: source.id, quote: value }],
  };
}

async function derive(facts: readonly ReturnType<typeof fact>[]) {
  return processCanonicalCandidateProfileExtraction(
    { extract: async () => ({ schemaVersion: 1, facts, issues: [] }) },
    { operationId: "multi-valued", sources: [source], allowProviderData: true },
  );
}

const conflictCodes = (result: Awaited<ReturnType<typeof derive>>) =>
  result.issues.map((issue) => issue.code).filter((code) => code.startsWith("conflict-"));

describe("deterministic conflicts apply only to single-valued fields", () => {
  it.each([
    ["achievement", "CV revision", ["Revision one", "Revision two", "Revision three"]],
    ["project", "Protocol study", ["Revision one", "Revision two"]],
    ["education", "Confirmation source", ["Revision one", "Revision two"]],
    ["role", "Event", ["Started 2020", "Started 2021", "Revision one"]],
    ["date", "Event", ["Started 2020", "Started 2021"]],
    ["role", "Confirmation source", ["Revision one", "Revision two"]],
  ])(
    "keeps several %s %s values for one subject without a conflict",
    async (category, field, values) => {
      const result = await derive(values.map((value) => fact(category, "subject-1", field, value)));

      expect(result.facts).toHaveLength(values.length);
      expect(conflictCodes(result)).toEqual([]);
    },
  );

  it("does not link different date fields of one role", async () => {
    const result = await derive([
      fact("date", "role-1", "Company creation date", "Started 2020"),
      fact("date", "role-1", "Employment period", "Started 2021"),
    ]);

    expect(conflictCodes(result)).toEqual([]);
  });

  it("merges identical collection values into one fact without a duplicate", async () => {
    const result = await derive([
      fact("achievement", "subject-1", "CV revision", "Revision one"),
      fact("achievement", "subject-1", "CV revision", "Revision one"),
    ]);

    expect(result.facts).toHaveLength(1);
    expect(result.issues.map((issue) => issue.code)).not.toContain("duplicate");
  });

  it("still conflicts on two start dates for one role", async () => {
    const result = await derive([
      fact("date", "role-1", "Start date", "Started 2020"),
      fact("date", "role-1", "Start date", "Started 2021"),
    ]);

    expect(conflictCodes(result)).toEqual(["conflict-date"]);
  });

  it("still conflicts on two titles for one role", async () => {
    const result = await derive([
      fact("role", "role-1", "Job title", "Revision one"),
      fact("role", "role-1", "Job title", "Revision two"),
    ]);

    expect(conflictCodes(result)).toEqual(["conflict-title"]);
  });

  it("still conflicts on two metrics of one achievement", async () => {
    const result = await derive([
      fact("achievement", "achievement-1", "Metric", "Revision one"),
      fact("achievement", "achievement-1", "Metric", "Revision two"),
    ]);

    expect(conflictCodes(result)).toEqual(["conflict-metric"]);
  });

  it("matches singular fields after case, hyphen, and underscore normalization", () => {
    const singular = (category: "role" | "date" | "education", field: string) =>
      !isCandidateProfileCollectionFact({ category, field });

    expect(singular("role", "Start-Date")).toBe(true);
    expect(singular("date", "employment_period")).toBe(true);
    expect(singular("education", "Degree")).toBe(true);
    expect(singular("role", "CV revision")).toBe(false);
    expect(singular("date", "Company creation date")).toBe(false);
  });

  it("recomputes issues over reused facts without any extraction", () => {
    const reference = { ...source.reference };
    const reusedFact = (id: string, field: string, value: string) => ({
      id,
      category: "role" as const,
      subjectId: "role-1",
      field,
      value,
      provenance: [reference],
    });
    const reconcile = (field: string) =>
      reconcileCanonicalCandidateProfileFacts({
        reusedFacts: [
          reusedFact("fact-a", field, "Value one"),
          reusedFact("fact-b", field, "Value two"),
        ],
        carriedIssues: [],
        extracted: { facts: [], issues: [] },
      }).issues.map((issue) => issue.code);

    expect(reconcile("CV revision")).not.toContain("conflict-value");
    expect(reconcile("Job title")).toContain("conflict-title");
  });
});
