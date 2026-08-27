import type { OpportunityBriefInput } from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";

import { buildOpportunityBrief } from "./opportunity-brief.js";

const createdAt = "2026-08-27T10:00:00.000Z";
const reviewedAt = "2026-08-27T10:01:00.000Z";
const checksum = "b".repeat(64);

function sourced(value: string, sourceIds: readonly string[]) {
  return { value, sourceIds: [...sourceIds] };
}

function completeBrief(): OpportunityBriefInput {
  return {
    schemaVersion: 1,
    id: "brief-application",
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
          capturedAt: createdAt,
          contentChecksum: checksum,
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
    role: sourced("Platform Engineer", ["job-source"]),
    employer: sourced("Example Systems", ["job-source"]),
    responsibilities: [
      { id: "responsibility-a", text: "Own platform reliability", sourceIds: ["job-source"] },
      { id: "responsibility-b", text: "Improve developer experience", sourceIds: ["job-source"] },
    ],
    requirements: [
      {
        id: "requirement-a",
        text: "Experience operating production systems",
        priority: "critical",
        sourceIds: ["job-source"],
      },
    ],
    priorities: [{ id: "priority-a", text: "Operational ownership", sourceIds: ["job-source"] }],
    candidateInstructions: {
      tone: sourced("Clear and direct", ["candidate-source"]),
      applicationGoal: null,
      forbiddenLanguage: [],
      focusAreas: [sourced("Reliability outcomes", ["candidate-source"])],
    },
    issues: [],
  };
}

describe("buildOpportunityBrief", () => {
  it("builds a provider-independent brief without reordering authored lists", () => {
    const input = completeBrief();
    const built = buildOpportunityBrief(input);

    expect(built).toEqual(input);
    expect(built.sources.map((source) => source.id)).toEqual(["job-source", "candidate-source"]);
    expect(built.responsibilities.map((entry) => entry.id)).toEqual([
      "responsibility-a",
      "responsibility-b",
    ]);
  });

  it("does not mutate input and deeply freezes the cloned result", () => {
    const input = completeBrief();
    const before = structuredClone(input);
    const built = buildOpportunityBrief(input);

    expect(input).toEqual(before);
    expect(built).not.toBe(input);
    expect(Object.isFrozen(built)).toBe(true);
    expect(Object.isFrozen(built.sources)).toBe(true);
    expect(Object.isFrozen(built.sources[0])).toBe(true);
    expect(Object.isFrozen(built.sources[0]?.provenance)).toBe(true);
    expect(Object.isFrozen(built.candidateInstructions)).toBe(true);
    expect(Object.isFrozen(built.candidateInstructions.focusAreas)).toBe(true);
    expect(Object.isFrozen(built.candidateInstructions.focusAreas[0])).toBe(true);

    const firstSource = built.sources[0];
    const firstFocusArea = built.candidateInstructions.focusAreas[0];
    if (firstSource === undefined || firstFocusArea === undefined) {
      throw new Error("complete brief fixture is missing required entries");
    }

    expect(() => {
      (firstSource as { id: string }).id = "changed";
    }).toThrow();
    expect(() => {
      (firstFocusArea as { value: string }).value = "changed";
    }).toThrow();
  });

  it("parses the strict contract before returning a brief", () => {
    expect(() => buildOpportunityBrief({ ...completeBrief(), unknown: true })).toThrow();
  });
});
