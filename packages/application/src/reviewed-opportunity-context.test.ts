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
      sources: [
        { id: "posting", classification: "job-posting" },
        { id: "entered", classification: "candidate-provided-fact" },
      ],
      employer: { value: "Example Systems", sourceIds: ["posting"] },
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

  it("names the employer, or says the job posting names none", () => {
    expect(reviewedOpportunityContext(record()).jobDescription).toContain(
      "Employer: Example Systems",
    );
    const unnamed = reviewedOpportunityContext(record({ employer: null })).jobDescription;
    expect(unnamed).toContain("Employer: not named in the job posting");
    expect(unnamed.split("\n")).not.toContain("Employer: ");
  });

  it("says an employer the candidate entered was entered by the candidate, not the posting", () => {
    const entered = reviewedOpportunityContext(
      record({ employer: { value: "Example Systems", sourceIds: ["entered"] } }),
    ).jobDescription;
    expect(entered).toContain("Employer: Example Systems (entered by the candidate)");
    const extracted = reviewedOpportunityContext(record()).jobDescription;
    expect(extracted).toContain("Employer: Example Systems");
    expect(extracted).not.toContain("entered by the candidate");
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
