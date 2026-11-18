import type { ScoredEvidenceChunk } from "@draft-loop/domain";
import { describe, expect, it } from "vitest";

import {
  applyRequirementEvidenceGrades,
  maximumGradedChunkCharacters,
  maximumGradedPairs,
  maximumGradeReasonCharacters,
  parseRequirementEvidenceGrades,
  requirementEvidenceGradeInput,
  requirementEvidenceGradeSummary,
} from "./requirement-evidence-grade.js";
import type { RequirementEvidenceMap } from "./requirement-evidence-map.js";

const chunk = (id: string, text: string) =>
  ({ id, sourceId: "source-1", text }) as unknown as ScoredEvidenceChunk;

const eligible = [
  chunk("lead", "Guided a team of five engineers through a platform rewrite."),
  chunk("trap", "Attended a machine learning meetup in an invented city."),
  chunk("long", "x".repeat(maximumGradedChunkCharacters + 50)),
];

const requirements = [
  { id: "r-lead", text: "Engineering leadership experience" },
  { id: "r-ml", text: "Machine learning in production" },
  { id: "r-none", text: "Native-level Mandarin" },
];

const map: RequirementEvidenceMap = {
  mode: "semantic",
  modelId: "fake-model",
  chunkCount: 3,
  entries: [
    { requirementId: "r-lead", candidates: [{ chunkId: "lead", score: 0.91, origin: "semantic" }] },
    {
      requirementId: "r-ml",
      candidates: [
        { chunkId: "lead", score: 0.83, origin: "semantic" },
        { chunkId: "trap", origin: "keyword" },
        { chunkId: "long", origin: "keyword" },
      ],
    },
    { requirementId: "r-none", candidates: [] },
  ],
};

describe("requirement-evidence grade", () => {
  const input = requirementEvidenceGradeInput(map, requirements, eligible);

  it("sends each graded requirement and chunk once, with the pairs in map order", () => {
    expect(input?.requirements.map(({ id }) => id)).toEqual(["r-lead", "r-ml"]);
    expect(input?.chunks.map(({ id }) => id)).toEqual(["lead", "trap", "long"]);
    expect(input?.chunks[2]?.text).toHaveLength(maximumGradedChunkCharacters);
    expect(input?.pairs).toEqual([
      { requirementId: "r-lead", chunkId: "lead" },
      { requirementId: "r-ml", chunkId: "lead" },
      { requirementId: "r-ml", chunkId: "trap" },
      { requirementId: "r-ml", chunkId: "long" },
    ]);
  });

  it("has nothing to grade without candidates", () => {
    expect(
      requirementEvidenceGradeInput(
        { ...map, entries: [{ requirementId: "r-none", candidates: [] }] },
        requirements,
        eligible,
      ),
    ).toBeUndefined();
  });

  it("caps the pairs one call grades", () => {
    const many: RequirementEvidenceMap = {
      ...map,
      entries: Array.from({ length: maximumGradedPairs + 5 }, (_, index) => ({
        requirementId: `r-${index}`,
        candidates: [{ chunkId: "lead", origin: "keyword" as const }],
      })),
    };
    const reqs = many.entries.map(({ requirementId }) => ({ id: requirementId, text: "x" }));
    expect(requirementEvidenceGradeInput(many, reqs, eligible)?.pairs).toHaveLength(
      maximumGradedPairs,
    );
  });

  it("keeps valid grades and drops unasked, duplicated or malformed ones", () => {
    if (input === undefined) throw new Error("expected input");
    const answers = parseRequirementEvidenceGrades(
      {
        grades: [
          { requirementId: "r-lead", chunkId: "lead", grade: "supports", reason: "Led engineers." },
          {
            requirementId: "r-ml",
            chunkId: "trap",
            grade: "does-not-support",
            reason: "Shares words only.",
          },
          // Graded twice: neither answer is trusted.
          { requirementId: "r-ml", chunkId: "lead", grade: "supports", reason: "Yes." },
          { requirementId: "r-ml", chunkId: "lead", grade: "does-not-support", reason: "No." },
          // Not asked.
          { requirementId: "r-none", chunkId: "lead", grade: "supports", reason: "Invented." },
          // Unknown grade, overlong reason, and a reasoning transcript.
          { requirementId: "r-ml", chunkId: "long", grade: "maybe", reason: "Unclear." },
          {
            requirementId: "r-lead",
            chunkId: "trap",
            grade: "supports",
            reason: "x".repeat(maximumGradeReasonCharacters + 1),
          },
        ],
      },
      input,
    );
    expect(answers).toEqual([
      { requirementId: "r-lead", chunkId: "lead", grade: "supports", reason: "Led engineers." },
      {
        requirementId: "r-ml",
        chunkId: "trap",
        grade: "does-not-support",
        reason: "Shares words only.",
      },
    ]);
    expect(
      parseRequirementEvidenceGrades(
        {
          grades: [
            {
              requirementId: "r-ml",
              chunkId: "long",
              grade: "supports",
              reason: "Chain of thought: first I read the chunk.",
            },
          ],
        },
        input,
      ),
    ).toEqual([]);
    expect(parseRequirementEvidenceGrades("not an object", input)).toEqual([]);
  });

  it("folds grades into the map and summarises them without reasons", () => {
    const graded = applyRequirementEvidenceGrades(map, [
      { requirementId: "r-lead", chunkId: "lead", grade: "supports", reason: "Led engineers." },
      { requirementId: "r-ml", chunkId: "trap", grade: "does-not-support", reason: "Words only." },
    ]);
    expect(graded.grading).toEqual({
      status: "graded",
      instructionsVersion: "evidence-grade-v1",
      gradedPairs: 2,
    });
    expect(graded.entries[0]?.candidates[0]).toMatchObject({
      chunkId: "lead",
      grade: "supports",
      reason: "Led engineers.",
    });
    expect(graded.entries[1]?.candidates[0]?.grade).toBeUndefined();
    const summary = requirementEvidenceGradeSummary(graded);
    expect(summary).toEqual({
      status: "graded",
      instructionsVersion: "evidence-grade-v1",
      gradedPairs: 2,
      supports: 1,
      partlySupports: 0,
      doesNotSupport: 1,
    });
    expect(JSON.stringify(summary)).not.toContain("Led engineers.");
  });

  it("marks a failed call and leaves every candidate ungraded", () => {
    const graded = applyRequirementEvidenceGrades(map, undefined);
    expect(graded.grading.status).toBe("failed");
    for (const { candidates } of graded.entries) {
      for (const candidate of candidates) expect(candidate.grade).toBeUndefined();
    }
  });
});
