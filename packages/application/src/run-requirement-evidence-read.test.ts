import type { ContextSnapshot } from "@draft-loop/domain";
import { describe, expect, it } from "vitest";

import { runRequirementEvidence } from "./run-requirement-evidence-read.js";

const context = {
  evidenceManifest: [{ id: "s1", path: "/invented/folder/career-notes.md" }],
  requirements: [
    { id: "r1", text: "Led a cloud migration" },
    { id: "r2", text: "Native-level Mandarin" },
  ],
} as unknown as Pick<ContextSnapshot, "evidenceManifest" | "requirements">;

const mapPayload = {
  mode: "semantic",
  modelId: "fake-model",
  chunkCount: 3,
  requirementCount: 2,
  requirementsWithEvidence: 1,
  entries: [
    {
      requirementId: "r1",
      candidates: [
        { chunkId: "c1", origin: "both", score: 0.91, sourceId: "s1", lineStart: 3, lineEnd: 7 },
        { chunkId: "c2", origin: "keyword" },
      ],
    },
    { requirementId: "r2", candidates: [] },
  ],
};

describe("run requirement evidence", () => {
  it("names each requirement and source and folds in the grades", () => {
    const evidence = runRequirementEvidence(
      "run-1",
      mapPayload,
      {
        status: "graded",
        entries: [{ requirementId: "r1", grades: [{ chunkId: "c2", grade: "does-not-support" }] }],
      },
      context,
    );
    expect(evidence).toEqual({
      runId: "run-1",
      mode: "semantic",
      modelId: "fake-model",
      chunkCount: 3,
      grading: "graded",
      requirements: [
        {
          requirementId: "r1",
          text: "Led a cloud migration",
          candidates: [
            {
              chunkId: "c1",
              origin: "both",
              score: 0.91,
              source: "career-notes.md",
              lineStart: 3,
              lineEnd: 7,
            },
            { chunkId: "c2", origin: "keyword", grade: "does-not-support" },
          ],
        },
        { requirementId: "r2", text: "Native-level Mandarin", candidates: [] },
      ],
    });
  });

  it("reads an ungraded map, ignores a malformed grade and refuses a malformed map", () => {
    const ungraded = runRequirementEvidence("run-1", mapPayload, undefined, undefined);
    expect(ungraded?.grading).toBeUndefined();
    expect(ungraded?.requirements[0]?.text).toBeUndefined();
    expect(runRequirementEvidence("run-1", mapPayload, { status: "odd" }, context)?.grading).toBe(
      undefined,
    );
    expect(runRequirementEvidence("run-1", { mode: "other" }, undefined, context)).toBeUndefined();
  });
});
