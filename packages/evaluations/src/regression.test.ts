import type { DraftArtifact } from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";

import {
  assertNoQualityRegression,
  compareEvaluationCase,
  type EvaluationCase,
  EvaluationRegressionError,
  type ReadinessEvaluationContext,
} from "./index.js";

const context: ReadinessEvaluationContext = {
  requirements: [
    { id: "requirement-typescript", text: "TypeScript systems engineer", priority: "critical" },
    { id: "requirement-kubernetes", text: "Kubernetes operations", priority: "critical" },
  ],
  outputConstraints: { requiredSections: ["Summary", "Experience"] },
  readinessRubric: {
    relevance: 0.75,
    evidence: 0.75,
    accuracy: 0.75,
    differentiation: 0.75,
    clarity: 0.75,
    format: 0.75,
    credibility: 0.75,
  },
};

function artifact(
  includeExperience: boolean,
  includeKubernetes: boolean,
  id: string,
): DraftArtifact {
  const sections: DraftArtifact["sections"] = [
    {
      id: `${id}-summary-section`,
      title: "Summary",
      kind: "summary",
      order: 0,
      blocks: [
        {
          id: `${id}-summary-block`,
          type: "paragraph",
          text: "TypeScript systems engineer.",
          claimIds: [`${id}-summary-claim`],
        },
      ],
    },
  ];
  const claims: DraftArtifact["claims"] = [
    {
      id: `${id}-summary-claim`,
      text: "TypeScript systems engineer.",
      sectionId: `${id}-summary-section`,
      blockId: `${id}-summary-block`,
      substantive: true,
      status: "verified",
      evidence: [
        {
          sourcePath: "fixture://synthetic/typescript",
          excerpt: "Synthetic evidence for TypeScript systems engineering.",
        },
      ],
    },
  ];

  if (includeExperience) {
    sections.push({
      id: `${id}-experience-section`,
      title: "Experience",
      kind: "experience",
      order: 1,
      blocks: [
        {
          id: `${id}-experience-block`,
          type: "bullet",
          text: includeKubernetes ? "Kubernetes operations." : "Platform operations.",
          claimIds: [`${id}-experience-claim`],
        },
      ],
    });
    claims.push({
      id: `${id}-experience-claim`,
      text: includeKubernetes ? "Kubernetes operations." : "Platform operations.",
      sectionId: `${id}-experience-section`,
      blockId: `${id}-experience-block`,
      substantive: true,
      status: "verified",
      evidence: [
        {
          sourcePath: "fixture://synthetic/kubernetes",
          excerpt: "Synthetic evidence for platform operations.",
        },
      ],
    });
  }

  return {
    schemaVersion: 1,
    id,
    version: 1,
    parentVersionId: null,
    createdAt: "2026-08-12T10:00:00.000Z",
    language: "en",
    sections,
    claims,
    decisions: [],
  };
}

function evaluationCase(
  revisedDraft: DraftArtifact,
  firstDraft: DraftArtifact = artifact(false, false, "first"),
): EvaluationCase {
  return {
    id: "synthetic-cv-regression",
    context,
    firstDraft,
    revisedDraft,
    manualBaseline: artifact(true, true, "manual"),
    userEffort: {
      "first-draft": { reviewMinutes: 20, editCount: 8, approvalCount: 1 },
      "revised-draft": { reviewMinutes: 12, editCount: 3, approvalCount: 1 },
      "manual-baseline": { reviewMinutes: 30, editCount: 15, approvalCount: 1 },
    },
  };
}

describe("evaluation comparison harness", () => {
  it("compares first, revised, and manual variants and passes the quality gate", () => {
    const comparison = compareEvaluationCase(evaluationCase(artifact(true, true, "revised")));

    expect(comparison.results.map((result) => result.variant)).toEqual([
      "first-draft",
      "revised-draft",
      "manual-baseline",
    ]);
    expect(comparison.deltas).toHaveLength(2);
    expect(comparison.deltas[0]?.readinessDelta).toBe(1);
    expect(comparison.deltas[0]?.reviewMinutesDelta).toBe(-8);
    expect(comparison.qualityRegression).toBe(false);
    expect(comparison.regressions).toEqual([]);

    expect(() => assertNoQualityRegression(comparison)).not.toThrow();
  });

  it("fails deterministically when the revised artifact regresses", () => {
    const comparison = compareEvaluationCase(
      evaluationCase(artifact(false, false, "degraded"), artifact(true, true, "first-good")),
    );

    expect(comparison.qualityRegression).toBe(true);
    expect(comparison.regressions).toContain("relevance dropped by 0.500000");
    expect(() => assertNoQualityRegression(comparison)).toThrow(EvaluationRegressionError);
  });
});
