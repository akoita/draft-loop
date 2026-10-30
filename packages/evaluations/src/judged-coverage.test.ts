import type { DraftArtifact } from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";

import {
  evaluateReadiness,
  type ReadinessEvaluationContext,
  type ReadinessEvaluationOptions,
} from "./index.js";

const artifact: DraftArtifact = {
  schemaVersion: 1,
  id: "artifact-1",
  version: 1,
  parentVersionId: null,
  createdAt: "2026-08-12T10:00:00.000Z",
  language: "en",
  sections: [
    {
      id: "section-summary",
      title: "Summary",
      kind: "summary",
      order: 0,
      blocks: [
        {
          id: "block-summary",
          type: "paragraph",
          text: "Platform engineer who ships statically typed services.",
          claimIds: [],
        },
      ],
    },
  ],
  claims: [],
  decisions: [],
};

const context: ReadinessEvaluationContext = {
  requirements: [
    { id: "requirement-1", text: "TypeScript experience", priority: "critical" },
    { id: "requirement-2", text: "Kubernetes operations", priority: "high" },
    { id: "requirement-3", text: "Mentoring juniors", priority: "medium" },
  ],
  outputConstraints: { requiredSections: [] },
  readinessRubric: {
    relevance: 0,
    evidence: 0,
    accuracy: 0,
    differentiation: 0,
    clarity: 0,
    format: 0,
    credibility: 0,
  },
};

const relevance = (options: ReadinessEvaluationOptions) => {
  const score = evaluateReadiness(artifact, context, options).scores.find(
    (candidate) => candidate.dimension === "relevance",
  );
  if (score === undefined) throw new Error("relevance is always scored");
  return score;
};

describe("judged requirement coverage in readiness", () => {
  it("counts only the listed requirements as covered, by priority weight", () => {
    expect(relevance({ round: 1 }).score).toBe(0);
    expect(relevance({ round: 1, coveredRequirementIds: ["requirement-1"] }).score).toBe(
      Number((2 / 4.5).toFixed(6)),
    );
    expect(
      relevance({ round: 1, coveredRequirementIds: ["requirement-1", "requirement-3"] }).score,
    ).toBe(Number((3 / 4.5).toFixed(6)));
    expect(relevance({ round: 1, coveredRequirementIds: ["unknown-requirement"] }).score).toBe(0);
  });

  it("weighs a nice-to-have at half a medium requirement (#1970)", () => {
    const withNiceToHave: ReadinessEvaluationContext = {
      ...context,
      requirements: [
        ...context.requirements,
        { id: "requirement-4", text: "Rust side projects", priority: "low" },
      ],
    };
    const score = evaluateReadiness(artifact, withNiceToHave, {
      round: 1,
      coveredRequirementIds: ["requirement-1", "requirement-2", "requirement-3"],
    }).scores.find((candidate) => candidate.dimension === "relevance")?.score;

    // 4.5 of 5: missing the nice-to-have costs a tenth, not the 18% a medium one would.
    expect(score).toBe(0.9);
  });

  it("does not count a listed requirement that is an explicit gap", () => {
    const score = relevance({
      round: 1,
      coveredRequirementIds: ["requirement-1", "requirement-2"],
      explicitGapRequirementIds: ["requirement-1"],
    });

    expect(score.score).toBe(Number((1.5 / 4.5).toFixed(6)));
  });

  it("explains how many requirements were covered by critic judgement", () => {
    expect(relevance({ round: 1 }).rationale).toBe(
      "0 of 3 requirements matched by deterministic coverage within individual blocks",
    );
    expect(relevance({ round: 1, coveredRequirementIds: ["requirement-1"] }).rationale).toBe(
      "1 of 3 requirements covered: 0 by deterministic coverage within individual blocks and 1 by critic judgement",
    );
  });

  it("matches today's result when no requirement is listed", () => {
    expect(evaluateReadiness(artifact, context, { round: 1, coveredRequirementIds: [] })).toEqual(
      evaluateReadiness(artifact, context, { round: 1 }),
    );
  });

  it("weights relevance over the scored requirements only (#1835)", () => {
    const scored = { ...context, scoredRequirementIds: ["requirement-1", "requirement-3"] };
    const options = { round: 1, coveredRequirementIds: ["requirement-1", "requirement-3"] };
    const score = evaluateReadiness(artifact, scored, options).scores.find(
      ({ dimension }) => dimension === "relevance",
    );
    expect(score?.score).toBe(1);
    expect(score?.rationale).toContain("2 of 2 requirements covered");
    // A list that names none of the requirements counts them all.
    const unknown = { ...context, scoredRequirementIds: ["unknown-requirement"] };
    expect(evaluateReadiness(artifact, unknown, { round: 1 })).toEqual(
      evaluateReadiness(artifact, context, { round: 1 }),
    );
  });
});
