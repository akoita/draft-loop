import { describe, expect, it } from "vitest";

import { reviewedOpportunityContext } from "./reviewed-opportunity-context.js";

const record = (overrides: Record<string, unknown> = {}) =>
  ({
    checksum: "a".repeat(64),
    brief: {
      id: "target-role",
      version: 3,
      status: "reviewed",
      role: { value: "Platform Engineer" },
      employer: { value: "Example Systems" },
      responsibilities: [
        { id: "extraction-responsibility-audit", text: "Prepare contracts for external audit" },
        { id: "extraction-responsibility-invariants", text: "Write invariant tests" },
      ],
      requirements: [
        {
          id: "extraction-requirement-solidity",
          text: "Solidity experience",
          priority: "critical",
        },
      ],
      priorities: [],
      candidateInstructions: {
        tone: null,
        applicationGoal: null,
        forbiddenLanguage: [],
        focusAreas: [],
      },
      ...overrides,
    },
  }) as never;

describe("reviewed opportunity context", () => {
  it("checks the job's responsibilities as requirements after the extracted requirements", () => {
    expect(reviewedOpportunityContext(record()).requirements).toEqual([
      { id: "extraction-requirement-solidity", text: "Solidity experience", priority: "critical" },
      {
        id: "extraction-responsibility-audit",
        text: "Prepare contracts for external audit",
        priority: "medium",
      },
      {
        id: "extraction-responsibility-invariants",
        text: "Write invariant tests",
        priority: "medium",
      },
    ]);
  });

  it("leaves a responsibility that repeats a requirement's id or text to that requirement", () => {
    const context = reviewedOpportunityContext(
      record({
        responsibilities: [
          { id: "shared-id", text: "Run the release train" },
          { id: "other-id", text: "  solidity   EXPERIENCE " },
          { id: "kept-id", text: "Mentor engineers" },
        ],
        requirements: [
          { id: "shared-id", text: "Release management", priority: "high" },
          { id: "solidity", text: "Solidity experience", priority: "critical" },
        ],
      }),
    );
    expect(context.requirements.map(({ id }) => id)).toEqual(["shared-id", "solidity", "kept-id"]);
  });

  it("keeps responsibilities in the job description text", () => {
    const context = reviewedOpportunityContext(record());
    expect(context.jobDescription).toContain(
      "Responsibilities:\n- Prepare contracts for external audit\n- Write invariant tests",
    );
    expect(context.opportunityBriefReference).toEqual({
      briefId: "target-role",
      version: 3,
      checksum: "a".repeat(64),
    });
  });

  it("refuses a brief that is not reviewed", () => {
    expect(() => reviewedOpportunityContext(record({ status: "draft" }))).toThrow(/not reviewed/u);
  });
});
