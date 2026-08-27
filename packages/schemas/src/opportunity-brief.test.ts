import { describe, expect, it } from "vitest";

import {
  type OpportunityBriefInput,
  opportunityBriefMaximumCollectionEntries,
  opportunityBriefMaximumTextLength,
  opportunityBriefSchema,
} from "./index.js";

const createdAt = "2026-08-27T10:00:00.000Z";
const reviewedAt = "2026-08-27T10:05:00.000Z";
const checksum = "a".repeat(64);

function sourced(value: string, sourceIds: readonly string[]) {
  return { value, sourceIds: [...sourceIds] };
}

function brief(overrides: Partial<OpportunityBriefInput> = {}): OpportunityBriefInput {
  return {
    schemaVersion: 1,
    id: "brief-1",
    version: 1,
    priorVersion: null,
    status: "reviewed",
    createdAt,
    reviewedAt,
    sources: [
      {
        id: "job-source",
        classification: "job-posting",
        status: "available",
        provenance: {
          kind: "approved-url",
          originalUrl: "https://jobs.example.test/platform",
          finalUrl: "https://jobs.example.test/platform#details",
          capturedAt: createdAt,
          contentChecksum: checksum,
        },
      },
      {
        id: "social-source",
        classification: "social-announcement",
        status: "available",
        provenance: {
          kind: "pasted-content",
          capturedAt: createdAt,
          checksum,
        },
      },
      {
        id: "company-source",
        classification: "company-context",
        status: "available",
        provenance: {
          kind: "local-file",
          displayName: "Company context",
          capturedAt: createdAt,
          checksum,
        },
      },
      {
        id: "candidate-source",
        classification: "candidate-instruction",
        status: "available",
        provenance: {
          kind: "candidate-input",
          capturedAt: createdAt,
          checksum,
        },
      },
    ],
    role: sourced("Senior Platform Engineer", ["job-source"]),
    employer: sourced("Example Systems", ["job-source", "company-source"]),
    responsibilities: [
      {
        id: "responsibility-1",
        text: "Lead platform reliability improvements",
        sourceIds: ["job-source"],
      },
      {
        id: "responsibility-2",
        text: "Communicate the platform roadmap",
        sourceIds: ["social-source", "company-source"],
      },
    ],
    requirements: [
      {
        id: "requirement-1",
        text: "Production TypeScript experience",
        priority: "critical",
        sourceIds: ["job-source"],
      },
      {
        id: "requirement-2",
        text: "Clear cross-team communication",
        priority: "high",
        sourceIds: ["social-source", "company-source"],
      },
    ],
    priorities: [
      {
        id: "priority-1",
        text: "Operational ownership",
        sourceIds: ["job-source"],
      },
    ],
    candidateInstructions: {
      tone: sourced("Direct and warm", ["candidate-source"]),
      applicationGoal: sourced("Emphasize platform leadership", ["candidate-source"]),
      forbiddenLanguage: [sourced("Do not use inflated claims", ["candidate-source"])],
      focusAreas: [sourced("Reliability outcomes", ["candidate-source"])],
    },
    issues: [
      {
        id: "issue-1",
        code: "contradiction",
        status: "acknowledged",
        severity: "warning",
        message: "Two available sources need a human reconciliation.",
        sourceIds: ["social-source", "company-source"],
      },
    ],
    ...overrides,
  };
}

function sourceAt(index: number) {
  const source = brief().sources[index];
  if (source === undefined) throw new Error(`missing source fixture at index ${index}`);
  return source;
}

function requirementAt(index: number) {
  const requirement = brief().requirements[index];
  if (requirement === undefined) throw new Error(`missing requirement fixture at index ${index}`);
  return requirement;
}

describe("opportunity brief schemas", () => {
  it("accepts a complete multi-source reviewed brief", () => {
    const parsed = opportunityBriefSchema.parse(brief());

    expect(parsed).toEqual(brief());
    expect(parsed.sources).toHaveLength(4);
    expect(parsed.requirements.map((requirement) => requirement.priority)).toEqual([
      "critical",
      "high",
    ]);
  });

  it("keeps draft failures and partial fetch issues visible", () => {
    const draft = brief({
      status: "draft",
      reviewedAt: null,
      role: null,
      employer: null,
      responsibilities: [],
      requirements: [],
      priorities: [],
      sources: [
        {
          id: "failed-source",
          classification: "job-posting",
          status: "failed",
          provenance: {
            kind: "approved-url",
            originalUrl: "https://jobs.example.test/unavailable",
            capturedAt: createdAt,
            contentChecksum: checksum,
          },
        },
        {
          id: "partial-source",
          classification: "company-context",
          status: "partial",
          provenance: {
            kind: "local-file",
            displayName: "Partial company notes",
            capturedAt: createdAt,
            checksum,
          },
        },
        {
          id: "candidate-source",
          classification: "candidate-instruction",
          status: "available",
          provenance: {
            kind: "candidate-input",
            capturedAt: createdAt,
            checksum,
          },
        },
      ],
      candidateInstructions: {
        tone: null,
        applicationGoal: null,
        forbiddenLanguage: [],
        focusAreas: [],
      },
      issues: [
        {
          id: "failed-issue",
          code: "fetch-failure",
          status: "open",
          severity: "error",
          message: "The approved source could not be fetched.",
          sourceIds: ["failed-source"],
        },
        {
          id: "partial-issue",
          code: "partial-fetch",
          status: "acknowledged",
          severity: "warning",
          message: "Only part of the local source was available.",
          sourceIds: ["partial-source"],
        },
      ],
    });

    expect(opportunityBriefSchema.parse(draft)).toEqual(draft);
  });

  it("requires provenance and matches each provenance variant strictly", () => {
    const missingProvenance = {
      ...brief(),
      sources: [{ id: "source-1", classification: "job-posting", status: "available" }],
    } as unknown as OpportunityBriefInput;
    expect(opportunityBriefSchema.safeParse(missingProvenance).success).toBe(false);

    const mismatchedProvenance = {
      ...brief(),
      sources: [
        {
          id: "source-1",
          classification: "job-posting",
          status: "available",
          provenance: {
            kind: "approved-url",
            originalUrl: "https://jobs.example.test/role",
            capturedAt: createdAt,
            checksum,
          },
        },
      ],
    } as unknown as OpportunityBriefInput;
    expect(opportunityBriefSchema.safeParse(mismatchedProvenance).success).toBe(false);
  });

  it("rejects duplicate ids and unresolved source references", () => {
    const duplicateSource = brief({
      sources: [sourceAt(0), { ...sourceAt(0), classification: "company-context" }],
    });
    expect(opportunityBriefSchema.safeParse(duplicateSource).success).toBe(false);

    const duplicateRequirement = brief({
      requirements: [requirementAt(0), { ...requirementAt(1), id: "requirement-1" }],
    });
    expect(opportunityBriefSchema.safeParse(duplicateRequirement).success).toBe(false);

    const unresolvedReference = brief({
      role: sourced("Unknown role source", ["missing-source"]),
    });
    expect(opportunityBriefSchema.safeParse(unresolvedReference).success).toBe(false);
  });

  it("keeps candidate instructions separate from extracted opportunity facts", () => {
    const contaminatedRole = brief({
      role: sourced("Role supplied as a candidate instruction", ["candidate-source"]),
    });
    expect(opportunityBriefSchema.safeParse(contaminatedRole).success).toBe(false);

    const contaminatedInstructions = brief({
      candidateInstructions: {
        ...brief().candidateInstructions,
        focusAreas: [sourced("A job requirement", ["job-source"])],
      },
    });
    expect(opportunityBriefSchema.safeParse(contaminatedInstructions).success).toBe(false);
  });

  it("enforces reviewed-state requirements and source-status issue mappings", () => {
    expect(opportunityBriefSchema.safeParse(brief({ reviewedAt: null })).success).toBe(false);
    expect(opportunityBriefSchema.safeParse(brief({ role: null })).success).toBe(false);
    expect(opportunityBriefSchema.safeParse(brief({ employer: null })).success).toBe(false);
    expect(opportunityBriefSchema.safeParse(brief({ requirements: [] })).success).toBe(false);
    expect(
      opportunityBriefSchema.safeParse({
        ...brief(),
        issues: [
          {
            id: "open-issue",
            code: "contradiction",
            status: "open",
            severity: "warning",
            message: "Needs review.",
            sourceIds: ["job-source"],
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      opportunityBriefSchema.safeParse(brief({ reviewedAt: "2026-08-27T09:59:59.000Z" })).success,
    ).toBe(false);

    const missingStatusIssue = brief({
      status: "draft",
      reviewedAt: null,
      sources: [
        {
          ...sourceAt(0),
          status: "stale",
        },
        sourceAt(1),
        sourceAt(2),
        sourceAt(3),
      ],
      role: null,
      employer: null,
      responsibilities: [],
      requirements: [],
      priorities: [],
      candidateInstructions: {
        tone: null,
        applicationGoal: null,
        forbiddenLanguage: [],
        focusAreas: [],
      },
      issues: [],
    });
    expect(opportunityBriefSchema.safeParse(missingStatusIssue).success).toBe(false);
  });

  it("rejects unknown keys, invalid URLs, and host paths", () => {
    expect(opportunityBriefSchema.safeParse({ ...brief(), unexpected: true }).success).toBe(false);
    expect(
      opportunityBriefSchema.safeParse({
        ...brief(),
        sources: [
          {
            ...sourceAt(0),
            provenance: {
              kind: "approved-url",
              originalUrl: "http://jobs.example.test/insecure",
              capturedAt: createdAt,
              contentChecksum: checksum,
            },
          },
          ...brief().sources.slice(1),
        ],
      }).success,
    ).toBe(false);
    expect(
      opportunityBriefSchema.safeParse({
        ...brief(),
        sources: [
          {
            ...sourceAt(0),
            provenance: {
              kind: "approved-url",
              originalUrl: "file:///tmp/secret",
              capturedAt: createdAt,
              contentChecksum: checksum,
            },
          },
          ...brief().sources.slice(1),
        ],
      }).success,
    ).toBe(false);
    expect(
      opportunityBriefSchema.safeParse({
        ...brief(),
        sources: [
          {
            ...sourceAt(2),
            provenance: {
              kind: "local-file",
              displayName: "/Users/candidate/private-notes.txt",
              capturedAt: createdAt,
              checksum,
            },
          },
          ...brief().sources.slice(0, 2),
          sourceAt(3),
        ],
      }).success,
    ).toBe(false);
  });

  it("enforces text and collection bounds", () => {
    expect(
      opportunityBriefSchema.safeParse({
        ...brief(),
        role: sourced("x".repeat(opportunityBriefMaximumTextLength + 1), ["job-source"]),
      }).success,
    ).toBe(false);
    expect(
      opportunityBriefSchema.safeParse({
        ...brief(),
        priorities: Array.from(
          { length: opportunityBriefMaximumCollectionEntries + 1 },
          (_, i) => ({
            id: `priority-${i}`,
            text: "A priority",
            sourceIds: ["job-source"],
          }),
        ),
      }).success,
    ).toBe(false);
  });

  it("requires version one to have no prior version and later versions to link immediately", () => {
    expect(opportunityBriefSchema.safeParse(brief({ priorVersion: 1 })).success).toBe(false);
    expect(
      opportunityBriefSchema.safeParse({ ...brief(), version: 2, priorVersion: null }).success,
    ).toBe(false);
    expect(
      opportunityBriefSchema.safeParse({ ...brief(), version: 2, priorVersion: 1 }).success,
    ).toBe(true);
    expect(
      opportunityBriefSchema.safeParse({ ...brief(), version: 3, priorVersion: 1 }).success,
    ).toBe(false);
  });
});
