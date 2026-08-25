import {
  buildIndependentReadinessReport,
  type IndependentReadinessEvaluationProjection,
} from "@draft-loop/evaluations";
import type {
  IndependentReadinessReportFindingInput,
  IndependentReadinessReportInputAssessment,
  IndependentReview,
} from "@draft-loop/schemas";
import {
  type AuthorAdjudicationDecisionInput,
  type DraftArtifact,
  draftArtifactSchema,
  readinessDimensions,
} from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";

import { buildAuthorAdjudicationPlan } from "./index.js";

const artifactInput = {
  schemaVersion: 1,
  id: "artifact-1",
  version: 1,
  parentVersionId: null,
  createdAt: "2026-08-25T10:00:00.000Z",
  language: "en",
  sections: [
    {
      id: "section-summary",
      title: "Summary",
      kind: "summary" as const,
      order: 0,
      blocks: [
        {
          id: "block-summary",
          type: "paragraph" as const,
          text: "Engineer building reliable systems.",
          claimIds: ["claim-1"],
        },
      ],
    },
    {
      id: "section-experience",
      title: "Experience",
      kind: "experience" as const,
      order: 1,
      blocks: [
        {
          id: "block-experience",
          type: "paragraph" as const,
          text: "Delivered dependable services.",
          claimIds: ["claim-2"],
        },
      ],
    },
  ],
  claims: [
    {
      id: "claim-1",
      text: "Engineer building reliable systems.",
      sectionId: "section-summary",
      blockId: "block-summary",
      substantive: true,
      status: "verified" as const,
      evidence: [
        {
          sourcePath: "/local/candidate/resume.md",
          sourceChecksum: "a".repeat(64),
          locator: "line:1-2",
          excerpt: "Built reliable systems.",
        },
      ],
    },
    {
      id: "claim-2",
      text: "Delivered dependable services.",
      sectionId: "section-experience",
      blockId: "block-experience",
      substantive: true,
      status: "verified" as const,
      evidence: [
        {
          sourcePath: "/local/candidate/experience.md",
          sourceChecksum: "b".repeat(64),
          locator: "line:3-4",
          excerpt: "Delivered dependable services.",
        },
      ],
    },
  ],
  decisions: [],
};

function sourceArtifact(): DraftArtifact {
  return draftArtifactSchema.parse(artifactInput);
}

const independentReview: IndependentReview = {
  authorLineage: "anthropic:author-v1",
  criticLineage: "openai:critic-v1",
  lineagesDistinct: true,
  required: true,
};

const inputAssessment: IndependentReadinessReportInputAssessment = {
  status: "complete",
  missingInputs: [],
};

const evaluation: IndependentReadinessEvaluationProjection = {
  scores: readinessDimensions.map((dimension) => ({
    dimension,
    score: 0.8,
    rationale: `score rationale for ${dimension}`,
  })),
  thresholdResults: readinessDimensions.map((dimension) => ({
    dimension,
    score: 0.8,
    threshold: 0.7,
    meets: true,
  })),
  meetsRubric: true,
};

function finding(
  id: string,
  target: IndependentReadinessReportFindingInput["target"],
  severity: "error" | "warning" = "error",
): IndependentReadinessReportFindingInput {
  return {
    id,
    code: `code-${id}`,
    category: "quality",
    severity,
    rationale: `report rationale for ${id}`,
    target,
    recommendedAction: `recommended action for ${id}`,
    confidence: 0.8,
  };
}

function report(
  findings: readonly IndependentReadinessReportFindingInput[] = [
    finding("finding-section", { kind: "section", id: "section-experience" }),
    finding("finding-claim", { kind: "claim", id: "claim-1" }),
  ],
) {
  return buildIndependentReadinessReport({
    metadata: {
      contextSnapshotId: "context-1",
      artifact: { id: "artifact-1", version: 1 },
      createdAt: "2026-08-25T10:00:00.000Z",
    },
    summary: "A bounded readiness report for the source artifact.",
    independentReview,
    inputAssessment,
    evaluation,
    deterministicFindings: findings,
    criticFindings: [],
  });
}

function decisions(): readonly AuthorAdjudicationDecisionInput[] {
  return [
    {
      findingId: "finding-claim",
      disposition: "accept" as const,
      rationale: "Revise the claim using the cited evidence.",
    },
    {
      findingId: "finding-section",
      disposition: "reject" as const,
      rationale: "Preserve the section because the author disagrees with this finding.",
    },
  ];
}

function firstDecision(): AuthorAdjudicationDecisionInput {
  const value = decisions()[0];
  if (value === undefined) {
    throw new Error("decision fixture is incomplete");
  }
  return value;
}

describe("author adjudication plan assembly", () => {
  it("binds the report and source artifact and preserves report order", () => {
    const result = buildAuthorAdjudicationPlan({
      report: report(),
      sourceArtifact: sourceArtifact(),
      createdAt: "2026-08-25T10:05:00.000Z",
      decisions: decisions(),
    });

    expect(result.contextSnapshotId).toBe("context-1");
    expect(result.sourceReport).toEqual({
      schemaVersion: 1,
      createdAt: "2026-08-25T10:00:00.000Z",
      artifact: { id: "artifact-1", version: 1 },
    });
    expect(result.sourceArtifact).toEqual({ id: "artifact-1", version: 1 });
    expect(result.decisions.map((decision) => decision.findingId)).toEqual([
      "finding-claim",
      "finding-section",
    ]);
    expect(result.decisions[0]).toMatchObject({
      origin: "deterministic",
      code: "code-finding-claim",
      severity: "error",
      target: { kind: "claim", id: "claim-1" },
      recommendedAction: "recommended action for finding-claim",
      disposition: "accept",
      effectRequirement: "revision-required",
    });
    expect(result.decisions[1]?.effectRequirement).toBe("disagreement-preserved");
  });

  it("requires one decision for every report finding and rejects unknown or duplicate ids", () => {
    expect(() =>
      buildAuthorAdjudicationPlan({
        report: report(),
        sourceArtifact: sourceArtifact(),
        createdAt: "2026-08-25T10:05:00.000Z",
        decisions: [firstDecision()],
      }),
    ).toThrow(/every report finding/i);
    expect(() =>
      buildAuthorAdjudicationPlan({
        report: report(),
        sourceArtifact: sourceArtifact(),
        createdAt: "2026-08-25T10:05:00.000Z",
        decisions: [...decisions(), { ...firstDecision(), findingId: "finding-unknown" }],
      }),
    ).toThrow(/not in the readiness report/i);
    expect(() =>
      buildAuthorAdjudicationPlan({
        report: report(),
        sourceArtifact: sourceArtifact(),
        createdAt: "2026-08-25T10:05:00.000Z",
        decisions: [firstDecision(), { ...firstDecision() }],
      }),
    ).toThrow(/duplicated/i);
  });

  it("rejects report/source identity mismatches and invalid artifact targets", () => {
    expect(() =>
      buildAuthorAdjudicationPlan({
        report: report(),
        sourceArtifact: draftArtifactSchema.parse({ ...artifactInput, id: "artifact-other" }),
        createdAt: "2026-08-25T10:05:00.000Z",
        decisions: decisions(),
      }),
    ).toThrow(/match the source artifact identity/i);
    expect(() =>
      buildAuthorAdjudicationPlan({
        report: report([finding("finding-claim", { kind: "claim", id: "claim-missing" })]),
        sourceArtifact: sourceArtifact(),
        createdAt: "2026-08-25T10:05:00.000Z",
        decisions: [
          {
            findingId: "finding-claim",
            disposition: "accept",
            rationale: "The finding should be revised.",
          },
        ],
      }),
    ).toThrow(/missing claim/i);
    expect(() =>
      buildAuthorAdjudicationPlan({
        report: report([finding("finding-section", { kind: "section", id: "section-missing" })]),
        sourceArtifact: sourceArtifact(),
        createdAt: "2026-08-25T10:05:00.000Z",
        decisions: [
          {
            findingId: "finding-section",
            disposition: "accept",
            rationale: "The finding should be revised.",
          },
        ],
      }),
    ).toThrow(/missing section/i);
  });

  it("returns a deeply immutable plan with only bounded finding metadata", () => {
    const result = buildAuthorAdjudicationPlan({
      report: report(),
      sourceArtifact: sourceArtifact(),
      createdAt: "2026-08-25T10:05:00.000Z",
      decisions: decisions(),
    });

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.sourceReport)).toBe(true);
    expect(Object.isFrozen(result.decisions)).toBe(true);
    expect(Object.isFrozen(result.decisions[0])).toBe(true);
    expect(Object.isFrozen(result.decisions[0]?.target)).toBe(true);
    expect(Object.keys(result.decisions[0] ?? {}).sort()).toEqual([
      "code",
      "disposition",
      "effectRequirement",
      "findingId",
      "origin",
      "rationale",
      "recommendedAction",
      "severity",
      "target",
    ]);
    expect(result.decisions[0]).not.toHaveProperty("category");
    expect(result.decisions[0]).not.toHaveProperty("confidence");
    expect(result.decisions[0]).not.toHaveProperty("chainOfThought");
  });
});
