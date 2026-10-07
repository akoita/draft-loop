import { describe, expect, it } from "vitest";

import {
  type OpportunityExtractionProposal,
  opportunityBriefMaximumCollectionEntries,
  opportunityBriefMaximumExcerptLength,
  opportunityBriefMaximumTextLength,
  opportunityExtractionProposalJsonSchema,
  opportunityExtractionProposalSchema,
} from "./index.js";

function sourced(value: string, sourceIds: readonly string[]) {
  return { value, sourceIds: [...sourceIds] };
}

function proposal(
  overrides: Partial<OpportunityExtractionProposal> = {},
): OpportunityExtractionProposal {
  return {
    schemaVersion: 1,
    role: sourced("Platform Engineer", ["job-source"]),
    employer: sourced("Example Systems", ["job-source"]),
    responsibilities: [
      {
        text: "Lead platform reliability",
        sourceIds: ["job-source"],
        excerpt: "You will lead platform reliability.",
      },
    ],
    requirements: [
      {
        text: "Production systems experience",
        priority: "critical",
        sourceIds: ["job-source"],
        excerpt: null,
      },
    ],
    priorities: [{ text: "Operational ownership", sourceIds: ["company-source"] }],
    contradictions: [{ field: "employer", sourceIds: ["job-source", "company-source"] }],
    ...overrides,
  };
}

describe("opportunity extraction proposal schema", () => {
  it("accepts a strict provider proposal without canonical or candidate fields", () => {
    const parsed = opportunityExtractionProposalSchema.parse(proposal());

    expect(parsed).toEqual(proposal());
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.responsibilities[0]).not.toHaveProperty("id");
    expect(parsed.requirements[0]).not.toHaveProperty("id");
    expect(parsed.priorities[0]).not.toHaveProperty("id");
  });

  it("exposes the same strict shape as draft-7 JSON schema", () => {
    expect(opportunityExtractionProposalJsonSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: [
        "schemaVersion",
        "role",
        "employer",
        "responsibilities",
        "requirements",
        "priorities",
        "contradictions",
      ],
    });
    const serialized = JSON.stringify(opportunityExtractionProposalJsonSchema);
    expect(serialized).not.toContain('"$schema"');
    expect(serialized).not.toContain("candidateInstructions");
    expect(serialized).not.toContain('"id"');
    expect(serialized).toContain('"minItems":2');
  });

  it("requires contradictions to cite at least two unique sources", () => {
    expect(
      opportunityExtractionProposalSchema.safeParse(
        proposal({ contradictions: [{ field: "role", sourceIds: ["job-source"] }] }),
      ).success,
    ).toBe(false);
    expect(
      opportunityExtractionProposalSchema.safeParse(
        proposal({ contradictions: [{ field: "role", sourceIds: ["job-source", "job-source"] }] }),
      ).success,
    ).toBe(false);
    expect(
      opportunityExtractionProposalSchema.safeParse(
        proposal({
          contradictions: [{ field: "unknown", sourceIds: ["job-source", "company-source"] }],
        } as never),
      ).success,
    ).toBe(false);
  });

  it("rejects model-owned ids, candidate instructions, unknown keys, and oversized values", () => {
    expect(
      opportunityExtractionProposalSchema.safeParse({
        ...proposal(),
        responsibilities: [
          { text: "Responsibility", sourceIds: ["job-source"], excerpt: null, id: "model-id" },
        ],
      }).success,
    ).toBe(false);
    expect(
      opportunityExtractionProposalSchema.safeParse({
        ...proposal(),
        candidateInstructions: { tone: sourced("Direct", ["candidate-source"]) },
      }).success,
    ).toBe(false);
    expect(
      opportunityExtractionProposalSchema.safeParse({ ...proposal(), unknown: true }).success,
    ).toBe(false);
    expect(
      opportunityExtractionProposalSchema.safeParse({
        ...proposal(),
        role: sourced("x".repeat(opportunityBriefMaximumTextLength + 1), ["job-source"]),
      }).success,
    ).toBe(false);
    expect(
      opportunityExtractionProposalSchema.safeParse({
        ...proposal(),
        priorities: Array.from({ length: opportunityBriefMaximumCollectionEntries + 1 }, () => ({
          text: "Priority",
          sourceIds: ["job-source"],
        })),
      }).success,
    ).toBe(false);
  });

  it("requires an explicit nullable excerpt on responsibilities and requirements", () => {
    const withoutExcerpt = proposal({
      responsibilities: [{ text: "Lead", sourceIds: ["job-source"] } as never],
    });
    expect(opportunityExtractionProposalSchema.safeParse(withoutExcerpt).success).toBe(false);
    expect(
      opportunityExtractionProposalSchema.safeParse(
        proposal({
          requirements: [
            { text: "Skill", priority: "high", sourceIds: ["job-source"], excerpt: null },
          ],
        }),
      ).success,
    ).toBe(true);
    const serialized = JSON.stringify(opportunityExtractionProposalJsonSchema);
    expect(serialized).toContain('"excerpt"');
    expect(serialized).toContain(`at most ${opportunityBriefMaximumExcerptLength} characters`);
  });

  it("accepts an over-long proposal excerpt so verification can drop it", () => {
    const excerpt = "x".repeat(opportunityBriefMaximumExcerptLength + 20);
    const build = (value: string) =>
      proposal({
        responsibilities: [{ text: "Lead", sourceIds: ["job-source"], excerpt: value }],
      });
    expect(opportunityExtractionProposalSchema.safeParse(build(excerpt)).success).toBe(true);
    expect(opportunityExtractionProposalSchema.safeParse(build("")).success).toBe(true);
    expect(opportunityExtractionProposalSchema.safeParse(build("x".repeat(2_001))).success).toBe(
      false,
    );
  });
});
