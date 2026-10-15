import { createHash } from "node:crypto";

import type { OpportunityBrief, OpportunityBriefInput } from "@draft-loop/schemas";
import { isCandidateProvidedSourcedText } from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";

import { buildOpportunityBrief } from "./opportunity-brief.js";
import { editOpportunityDraft, reviewOpportunityDraft } from "./opportunity-intake.js";
import { reviewedOpportunityContext } from "./reviewed-opportunity-context.js";

const createdAt = "2026-08-27T10:00:00.000Z";
const editedAt = "2026-08-27T10:05:00.000Z";
const reviewedAt = "2026-08-27T10:10:00.000Z";
const checksum = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

function draft(overrides: Partial<OpportunityBriefInput> = {}): OpportunityBrief {
  return buildOpportunityBrief({
    schemaVersion: 1,
    id: "brief-1",
    version: 1,
    priorVersion: null,
    status: "draft",
    createdAt,
    reviewedAt: null,
    sources: [
      {
        id: "job-source",
        classification: "job-posting",
        status: "available",
        provenance: { kind: "pasted-content", capturedAt: createdAt, checksum: checksum("job") },
      },
    ],
    role: { value: "Platform Engineer", sourceIds: ["job-source"] },
    employer: null,
    responsibilities: [],
    requirements: [
      {
        id: "requirement-1",
        text: "Production systems experience",
        priority: "critical",
        sourceIds: ["job-source"],
      },
    ],
    priorities: [],
    candidateInstructions: {
      tone: null,
      applicationGoal: null,
      forbiddenLanguage: [],
      focusAreas: [],
    },
    issues: [],
    ...overrides,
  });
}

const contextOf = (brief: OpportunityBrief) =>
  reviewedOpportunityContext({ workspaceId: "w", brief, checksum: "a".repeat(64) });

describe("candidate-entered employer", () => {
  it("records the employer against its own candidate-provided source, never the posting", () => {
    const edited = editOpportunityDraft(
      draft(),
      { candidateEmployer: "  Example Systems " },
      editedAt,
    );

    expect(edited.employer).toEqual({
      value: "Example Systems",
      sourceIds: ["candidate-employer-v2"],
    });
    expect(edited.sources).toHaveLength(2);
    expect(edited.sources[0]?.classification).toBe("job-posting");
    expect(edited.sources[1]).toEqual({
      id: "candidate-employer-v2",
      classification: "candidate-provided-fact",
      status: "available",
      provenance: {
        kind: "candidate-input",
        capturedAt: editedAt,
        checksum: checksum("Example Systems"),
      },
    });
    expect(edited.employer?.sourceIds).not.toContain("job-source");
    expect(isCandidateProvidedSourcedText(edited.employer, edited.sources)).toBe(true);
    expect(Object.isFrozen(edited.employer)).toBe(true);
  });

  it("survives review and tells the author the candidate entered it", () => {
    const edited = editOpportunityDraft(
      draft(),
      { candidateEmployer: "Example Systems" },
      editedAt,
    );
    const reviewed = reviewOpportunityDraft(edited, reviewedAt);
    expect(isCandidateProvidedSourcedText(reviewed.employer, reviewed.sources)).toBe(true);
    expect(contextOf(reviewed).jobDescription).toContain(
      "Employer: Example Systems (entered by the candidate)",
    );
  });

  it("does not mark an employer the posting names as entered by the candidate", () => {
    const named = draft({ employer: { value: "Example Systems", sourceIds: ["job-source"] } });
    expect(isCandidateProvidedSourcedText(named.employer, named.sources)).toBe(false);
    const reviewed = reviewOpportunityDraft(named, reviewedAt);
    expect(contextOf(reviewed).jobDescription).toContain("Employer: Example Systems\n");
    expect(contextOf(reviewed).jobDescription).not.toContain("entered by the candidate");
  });

  it("refuses an empty employer, a brief that already names one, and a double edit", () => {
    expect(() => editOpportunityDraft(draft(), { candidateEmployer: "   " }, editedAt)).toThrow(
      /empty/u,
    );
    const named = draft({ employer: { value: "Example Systems", sourceIds: ["job-source"] } });
    expect(() => editOpportunityDraft(named, { candidateEmployer: "Other" }, editedAt)).toThrow(
      /names no employer/u,
    );
    expect(() =>
      editOpportunityDraft(
        draft(),
        { candidateEmployer: "Other", employer: { value: "X", sourceIds: ["job-source"] } },
        editedAt,
      ),
    ).toThrow(/not both/u);
  });

  it("refuses to attribute the candidate's entry to the posting afterwards", () => {
    const edited = editOpportunityDraft(
      draft(),
      { candidateEmployer: "Example Systems" },
      editedAt,
    );
    expect(() =>
      editOpportunityDraft(
        edited,
        {
          employer: {
            value: "Example Systems",
            sourceIds: ["candidate-employer-v2", "job-source"],
          },
        },
        reviewedAt,
      ),
    ).toThrow();
  });
});
