import type { DraftArtifact } from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";

import {
  evaluateReadiness,
  type ReadinessEvaluationContext,
  type ReadinessScoreVector,
  readinessDimensions,
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
          text: "TypeScript systems engineer.",
          claimIds: ["claim-summary"],
        },
      ],
    },
  ],
  claims: [
    {
      id: "claim-summary",
      text: "TypeScript systems engineer.",
      sectionId: "section-summary",
      blockId: "block-summary",
      substantive: true,
      status: "verified",
      evidence: [
        {
          sourcePath: "/local/evidence.txt",
          excerpt: "TypeScript systems engineer.",
        },
      ],
    },
  ],
  decisions: [],
};

function context(
  rubric: Partial<ReadinessEvaluationContext["readinessRubric"]> = {},
): ReadinessEvaluationContext {
  return {
    requirements: [
      { id: "requirement-typescript", text: "TypeScript systems", priority: "critical" },
    ],
    outputConstraints: { requiredSections: [" summary "] },
    readinessRubric: {
      relevance: 0,
      evidence: 0,
      accuracy: 0,
      differentiation: 0,
      clarity: 0,
      format: 0,
      credibility: 0,
      ...rubric,
    },
  };
}

function scoreVector(value: number): ReadinessScoreVector {
  return Object.fromEntries(
    readinessDimensions.map((dimension) => [dimension, value]),
  ) as ReadinessScoreVector;
}

describe("deterministic readiness evaluation", () => {
  it("returns every canonical dimension and is ready when all rubric thresholds pass", () => {
    const result = evaluateReadiness(
      artifact,
      context({
        relevance: 0.8,
        evidence: 0.8,
        accuracy: 0.8,
        differentiation: 0.8,
        clarity: 0.8,
        format: 0.8,
        credibility: 0.8,
      }),
      { round: 1 },
    );

    expect(result.scores.map((score) => score.dimension)).toEqual(readinessDimensions);
    expect(result.scores.every((score) => score.score >= 0 && score.score <= 1)).toBe(true);
    expect(result.thresholdResults).toHaveLength(readinessDimensions.length);
    expect(result.meetsRubric).toBe(true);
    expect(result.ready).toBe(true);
    expect(result.stopReason).toBe("ready");
    expect(result.shouldStop).toBe(true);
    expect(result.status).toBe("ready");
  });

  it("stops on blocking findings without claiming readiness", () => {
    const result = evaluateReadiness(artifact, context(), {
      findings: [
        {
          code: "unsupported-claim",
          category: "evidence",
          severity: "error",
          message: "substantive claim has no evidence references",
          claimId: "claim-summary",
          sectionId: "section-summary",
        },
      ],
    });

    expect(result.ready).toBe(false);
    expect(result.stopReason).toBe("blocked-findings");
    expect(result.status).toBe("awaiting-approval");
    expect(result.bestAvailable).toBe(true);
  });

  it("recognizes stable convergence from the previous score vector", () => {
    const rubric = {
      ...context({ relevance: 1 }),
      requirements: [
        {
          id: "requirement-typescript",
          text: "Kubernetes",
          priority: "critical" as const,
        },
      ],
    };
    const first = evaluateReadiness(artifact, rubric, { round: 1 });
    const result = evaluateReadiness(artifact, rubric, {
      round: 2,
      priorScoreHistory: [first.scores],
      stableRounds: 2,
      scoreDelta: 0.05,
      maxRounds: 3,
    });

    expect(result.meetsRubric).toBe(false);
    expect(result.stable).toBe(true);
    expect(result.ready).toBe(false);
    expect(result.stopReason).toBe("stable-convergence");
    expect(result.status).toBe("awaiting-approval");
    expect(result.bestAvailable).toBe(true);
  });

  it("stops at the maximum round when scores have not stabilized", () => {
    const evaluationContext = {
      ...context({ relevance: 1 }),
      requirements: [
        {
          id: "requirement-typescript",
          text: "Kubernetes",
          priority: "critical" as const,
        },
      ],
    };
    const result = evaluateReadiness(artifact, evaluationContext, {
      round: 3,
      priorScoreHistory: [scoreVector(0), scoreVector(0)],
      stableRounds: 2,
      scoreDelta: 0.05,
      maxRounds: 3,
    });

    expect(result.ready).toBe(false);
    expect(result.stable).toBe(false);
    expect(result.stopReason).toBe("max-rounds");
    expect(result.shouldStop).toBe(true);
  });

  it("continues before stability or the maximum round", () => {
    const evaluationContext = {
      ...context({ relevance: 1 }),
      requirements: [
        {
          id: "requirement-typescript",
          text: "Kubernetes",
          priority: "critical" as const,
        },
      ],
    };
    const result = evaluateReadiness(artifact, evaluationContext, {
      round: 1,
      maxRounds: 3,
    });

    expect(result.ready).toBe(false);
    expect(result.stopReason).toBe("continue");
    expect(result.shouldStop).toBe(false);
    expect(result.status).toBe("continue");
  });

  it("supports positional gap, round, and history arguments", () => {
    const previous = { ...scoreVector(1), relevance: 0 };
    const result = evaluateReadiness(
      artifact,
      context({ relevance: 0.8 }),
      ["requirement-typescript"],
      2,
      [previous],
    );

    expect(result.round).toBe(2);
    expect(result.stopReason).toBe("stable-convergence");
  });
});
