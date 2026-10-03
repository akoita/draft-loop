import { canonicalCandidateProfileExtractionProposalSchema } from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";
import {
  CandidateProfileProposalValidationError,
  parseCanonicalCandidateProfileExtractionProposal,
} from "./candidate-profile-proposal-validation.js";

function fact(key: string, value = "TypeScript") {
  return {
    key,
    category: "skill",
    field: "name",
    value,
    evidence: [{ sourceId: "source-a", quote: value }],
  };
}

function proposal(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    facts: [fact("fact-a"), fact("fact-b", "React")],
    issues: [{ code: "omission", factKeys: [], sourceIds: [] }],
    ...overrides,
  };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function expectValidationFailure(value: unknown, code: string, count = 1): void {
  try {
    parseCanonicalCandidateProfileExtractionProposal(value);
    throw new Error("Expected the proposal validation to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(CandidateProfileProposalValidationError);
    expect((error as CandidateProfileProposalValidationError).diagnosticCounts).toContainEqual({
      code,
      count,
    });
  }
}

describe("canonical candidate profile proposal validation", () => {
  it("deduplicates only redundant evidence and issue references without mutating input", () => {
    const input = deepFreeze(
      proposal({
        facts: [
          {
            ...fact("fact-a"),
            evidence: [
              { sourceId: "source-a", quote: "TypeScript" },
              { sourceId: " source-a ", quote: " TypeScript " },
              { sourceId: "source-b", quote: "Used TypeScript at work" },
            ],
          },
          fact("fact-b", "React"),
        ],
        issues: [
          {
            code: "conflict-value",
            factKeys: ["fact-a", "fact-b", " fact-a "],
            sourceIds: ["source-a", " source-a ", "source-b"],
          },
        ],
      }),
    );
    const before = structuredClone(input);

    const parsed = parseCanonicalCandidateProfileExtractionProposal(input);

    expect(parsed.facts[0]?.evidence).toEqual([
      { sourceId: "source-a", quote: "TypeScript" },
      { sourceId: "source-b", quote: "Used TypeScript at work" },
    ]);
    expect(parsed.issues[0]).toEqual({
      code: "conflict-value",
      factKeys: ["fact-a", "fact-b"],
      sourceIds: ["source-a", "source-b"],
    });
    expect(input).toEqual(before);
  });

  it("keeps a fresh valid proposal unchanged", () => {
    const input = proposal();
    expect(parseCanonicalCandidateProfileExtractionProposal(input)).toEqual(
      canonicalCandidateProfileExtractionProposalSchema.parse(input),
    );
  });

  it("does not repair duplicate fact keys or unsupported values", () => {
    expectValidationFailure(
      proposal({ facts: [fact("fact-a"), fact("fact-a")] }),
      "profile_duplicate_fact_keys",
    );
    expectValidationFailure(
      proposal({
        facts: [fact("fact-a", "TypeScript"), { ...fact("fact-b"), category: "private" }],
      }),
      "profile_output_invalid_value",
    );
  });

  it("reports conflict issues made unpaired by duplicate fact-key removal", () => {
    expectValidationFailure(
      proposal({
        issues: [{ code: "conflict-value", factKeys: ["fact-a", "fact-a"], sourceIds: [] }],
      }),
      "profile_unpaired_conflicts",
    );
  });

  it("does not repair structural failures or oversized duplicate lists", () => {
    const withUnknownKey = proposal({
      unexpected: "private-field-name",
      facts: [
        {
          ...fact("fact-a"),
          evidence: [
            { sourceId: "source-a", quote: "TypeScript" },
            { sourceId: "source-a", quote: "TypeScript" },
          ],
        },
        fact("fact-b", "React"),
      ],
    });
    expectValidationFailure(withUnknownKey, "profile_output_unrecognized_keys");

    const oversized = proposal({
      facts: [
        {
          ...fact("fact-a"),
          evidence: Array.from({ length: 33 }, () => ({
            sourceId: "source-a",
            quote: "TypeScript",
          })),
        },
        fact("fact-b", "React"),
      ],
    });
    expectValidationFailure(oversized, "profile_output_too_big");
  });

  it("preserves exact failure reasons without retaining values, keys, paths, or schema messages", () => {
    const privateValue = "private candidate wording";
    const input = proposal({
      facts: [
        {
          ...fact("fact-a", privateValue),
          evidence: [
            { sourceId: "source-a", quote: privateValue },
            { sourceId: " source-a ", quote: ` ${privateValue} ` },
          ],
        },
        fact("fact-b", "React"),
      ],
      issues: [{ code: "omission", factKeys: ["missing-fact-key"], sourceIds: [] }],
    });

    let caught: unknown;
    try {
      parseCanonicalCandidateProfileExtractionProposal(input);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CandidateProfileProposalValidationError);
    expect(caught).toMatchObject({
      diagnosticCounts: [
        { code: "profile_duplicate_evidence", count: 1 },
        { code: "profile_unknown_issue_facts", count: 1 },
      ],
    });
    const errorText = JSON.stringify(caught);
    expect(errorText).not.toContain(privateValue);
    expect(errorText).not.toContain("missing-fact-key");
    expect(errorText).not.toContain("issues[0]");
    expect(errorText).not.toContain("must reference proposal facts");
  });
});
