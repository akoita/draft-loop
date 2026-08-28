import { canonicalCandidateProfileFactCategories } from "@draft-loop/domain";
import { describe, expect, it, vi } from "vitest";

import {
  type CanonicalCandidateProfileExtractionInput,
  canonicalCandidateProfileExtractionApprovalErrorMessage,
  processCanonicalCandidateProfileExtraction,
} from "./candidate-profile-extraction.js";

const checksum = "a".repeat(64);
const candidateText = [
  "Candidate-provided career history.",
  ...canonicalCandidateProfileFactCategories.map((category) => `${category}-value`),
  "Engineer",
  "Senior Engineer",
  "TypeScript",
  "2022",
  "2023",
].join("\n");

function material(
  overrides: Partial<CanonicalCandidateProfileExtractionInput["sources"][number]> = {},
): CanonicalCandidateProfileExtractionInput["sources"][number] {
  return {
    id: "source-a",
    mediaType: "text/markdown",
    checksum,
    text: candidateText,
    reference: {
      storeId: "store-1",
      knowledgeBaseId: "knowledge-1",
      sourceId: "source-1",
      versionId: "version-1",
      kind: "candidate-provided",
    },
    ...overrides,
  };
}

function proposalFacts() {
  return canonicalCandidateProfileFactCategories.map((category, index) => ({
    key: `fact-${index + 1}`,
    category,
    ...(category === "role" || category === "employer" || category === "date"
      ? { subjectKey: "employment-example" }
      : {}),
    field: `${category}-field`,
    value: `${category}-value`,
    evidence: [{ sourceId: "source-a", quote: `${category}-value` }],
  }));
}

describe("canonical candidate profile extraction", () => {
  it("maps every profile category to deterministic application-owned facts", async () => {
    const extract = vi.fn(async () => ({
      schemaVersion: 1,
      facts: proposalFacts(),
      issues: [],
    }));
    const input = {
      operationId: "profile-operation",
      sources: [material()],
      allowProviderData: true,
    } as const;

    const first = await processCanonicalCandidateProfileExtraction({ extract }, input);
    const second = await processCanonicalCandidateProfileExtraction({ extract }, input);

    expect(first).toEqual(second);
    expect(first.facts.map((fact) => fact.category).sort()).toEqual(
      [...canonicalCandidateProfileFactCategories].sort(),
    );
    expect(first.issues).toEqual([]);
    expect(new Set(first.facts.map((fact) => fact.id)).size).toBe(first.facts.length);
    expect(first.facts.every((fact) => fact.provenance[0]?.versionId === "version-1")).toBe(true);
    expect(first.facts.find((fact) => fact.category === "role")?.subjectId).toBe(
      first.facts.find((fact) => fact.category === "employer")?.subjectId,
    );
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.facts)).toBe(true);
    expect(extract).toHaveBeenCalledWith({
      operationId: "profile-operation",
      sources: [
        {
          id: "source-a",
          mediaType: "text/markdown",
          checksum,
          text: candidateText,
        },
      ],
    });
    expect(JSON.stringify(extract.mock.calls)).not.toContain("knowledge-1");
    expect(JSON.stringify(extract.mock.calls)).not.toContain("version-1");
  });

  it("keeps conflicting and duplicate facts while adding visible omissions", async () => {
    const result = await processCanonicalCandidateProfileExtraction(
      {
        extract: async () => ({
          schemaVersion: 1,
          facts: [
            {
              key: "role-a",
              category: "role",
              subjectKey: "employment-1",
              field: "title",
              value: "Engineer",
              evidence: [{ sourceId: "source-a", quote: "Engineer" }],
            },
            {
              key: "role-b",
              category: "role",
              subjectKey: "employment-1",
              field: "title",
              value: "Senior Engineer",
              evidence: [{ sourceId: "source-a", quote: "Senior Engineer" }],
            },
            {
              key: "skill-a",
              category: "skill",
              subjectKey: "skill-typescript",
              field: "name",
              value: "TypeScript",
              evidence: [{ sourceId: "source-a", quote: "TypeScript" }],
            },
            {
              key: "skill-b",
              category: "skill",
              subjectKey: "skill-typescript",
              field: "name",
              value: "TypeScript",
              evidence: [{ sourceId: "source-a", quote: "TypeScript" }],
            },
          ],
          issues: [],
        }),
      },
      { operationId: "profile-operation", sources: [material()], allowProviderData: true },
    );

    expect(result.facts).toHaveLength(4);
    expect(result.issues.some((issue) => issue.code === "conflict-title")).toBe(true);
    expect(result.issues.some((issue) => issue.code === "duplicate")).toBe(true);
    expect(result.issues.filter((issue) => issue.code === "omission")).toHaveLength(10);
    expect(result.issues.every((issue) => issue.status === "open")).toBe(true);
  });

  it("maps declared issue relationships without accepting provider-authored messages", async () => {
    const result = await processCanonicalCandidateProfileExtraction(
      {
        extract: async () => ({
          schemaVersion: 1,
          facts: [
            {
              key: "date-a",
              category: "date",
              subjectKey: "employment-1",
              field: "start-date",
              value: "2022",
              evidence: [{ sourceId: "source-a", quote: "2022" }],
            },
            {
              key: "date-b",
              category: "date",
              subjectKey: "employment-1",
              field: "start-date",
              value: "2023",
              evidence: [{ sourceId: "source-a", quote: "2023" }],
            },
          ],
          issues: [
            {
              code: "conflict-date",
              factKeys: ["date-a", "date-b"],
              sourceIds: ["source-a"],
            },
          ],
        }),
      },
      { operationId: "profile-operation", sources: [material()], allowProviderData: true },
    );

    const conflicts = result.issues.filter((issue) => issue.code === "conflict-date");
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      severity: "error",
      status: "open",
      message: "Candidate-provided sources contain conflicting dates.",
    });
    expect(conflicts[0]?.factIds).toHaveLength(2);
  });

  it("fails closed with one fixed content-free issue for invalid output or citations", async () => {
    const privateText = "private candidate content";
    const failure = await processCanonicalCandidateProfileExtraction(
      {
        extract: async () => ({
          schemaVersion: 1,
          facts: [
            {
              key: "invented",
              category: "role",
              field: "title",
              value: privateText,
              evidence: [{ sourceId: "unavailable-source", quote: privateText }],
            },
          ],
          issues: [],
        }),
      },
      {
        operationId: "profile-operation",
        sources: [material({ text: privateText })],
        allowProviderData: true,
      },
    );

    expect(failure.facts).toEqual([]);
    expect(failure.issues).toHaveLength(1);
    expect(failure.issues[0]).toMatchObject({ code: "omission", severity: "error" });
    expect(JSON.stringify(failure)).not.toContain(privateText);

    const ungrounded = await processCanonicalCandidateProfileExtraction(
      {
        extract: async () => ({
          schemaVersion: 1,
          facts: [
            {
              key: "ungrounded",
              category: "role",
              field: "title",
              value: "Invented role",
              evidence: [{ sourceId: "source-a", quote: "Candidate-provided career history." }],
            },
          ],
          issues: [],
        }),
      },
      { operationId: "profile-operation", sources: [material()], allowProviderData: true },
    );
    expect(ungrounded.facts).toEqual([]);
    expect(ungrounded.issues).toHaveLength(1);
    expect(JSON.stringify(ungrounded)).not.toContain("Invented role");

    const thrown = await processCanonicalCandidateProfileExtraction(
      { extract: async () => ({ schemaVersion: 1, facts: [], issues: [] }) },
      {
        operationId: "profile-operation",
        allowProviderData: true,
        sources: [
          material({
            reference: { ...material().reference, kind: "public-corroboration" },
          }),
        ],
      },
    );
    expect(thrown.facts).toEqual([]);
    expect(thrown.issues[0]?.severity).toBe("error");
  });

  it("requires direct approval, rejects path-bearing references, and propagates cancellation", async () => {
    const extract = vi.fn(async () => ({ schemaVersion: 1, facts: [], issues: [] }));
    await expect(
      processCanonicalCandidateProfileExtraction(
        { extract },
        { operationId: "profile-operation", sources: [material()], allowProviderData: false },
      ),
    ).rejects.toThrow(canonicalCandidateProfileExtractionApprovalErrorMessage);
    expect(extract).not.toHaveBeenCalled();

    const unsafe = await processCanonicalCandidateProfileExtraction(
      { extract },
      {
        operationId: "profile-operation",
        allowProviderData: true,
        sources: [
          material({
            reference: { ...material().reference, sourceId: "/private/candidate.md" },
          }),
        ],
      },
    );
    expect(unsafe.facts).toEqual([]);
    expect(JSON.stringify(unsafe)).not.toContain("/private/candidate.md");

    const controller = new AbortController();
    controller.abort();
    await expect(
      processCanonicalCandidateProfileExtraction(
        {
          extract: async () => {
            throw new DOMException("cancelled", "AbortError");
          },
        },
        {
          operationId: "profile-operation",
          allowProviderData: true,
          sources: [material()],
          signal: controller.signal,
        },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
