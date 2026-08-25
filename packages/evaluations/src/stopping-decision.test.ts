import type {
  AdjudicatedRevisionTrace,
  IndependentReadinessReport,
  ReadinessDimensionAgreement,
} from "@draft-loop/schemas";
import { applicationReadinessStoppingDecisionSchema } from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";

import {
  type ApplicationReadinessStoppingLoopContext,
  type EvaluateApplicationReadinessStoppingDecisionInput,
  evaluateApplicationReadinessStoppingDecision,
  readinessDimensions,
} from "./index.js";

function artifact(version = 1) {
  return {
    schemaVersion: 1 as const,
    id: version === 1 ? "artifact-1" : "artifact-2",
    version,
    parentVersionId: version === 1 ? null : "artifact-1",
    createdAt: version === 1 ? "2026-08-26T10:00:00.000Z" : "2026-08-26T10:06:00.000Z",
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
            text: version === 1 ? "Built reliable systems." : "Built dependable systems.",
            claimIds: ["claim-1"],
          },
        ],
      },
    ],
    claims: [
      {
        id: "claim-1",
        text: version === 1 ? "Built reliable systems." : "Built dependable systems.",
        sectionId: "section-summary",
        blockId: "block-summary",
        substantive: true,
        status: "verified" as const,
        evidence: [
          {
            sourcePath: "/local/evidence.txt",
            excerpt: "Built reliable systems.",
          },
        ],
      },
    ],
    decisions: [],
  };
}

function evaluation() {
  return {
    scores: readinessDimensions.map((dimension) => ({
      dimension,
      score: 0.9,
      rationale: `The ${dimension} score is supported by the independent review.`,
    })),
    thresholdResults: readinessDimensions.map((dimension) => ({
      dimension,
      score: 0.9,
      threshold: 0.8,
      meets: true,
    })),
    meetsRubric: true,
  };
}

function report(
  currentArtifact: ReturnType<typeof artifact> = artifact(),
  overrides: Record<string, unknown> = {},
): IndependentReadinessReport {
  return {
    schemaVersion: 1,
    contextSnapshotId: "context-1",
    artifact: { id: currentArtifact.id, version: currentArtifact.version },
    createdAt:
      currentArtifact.version === 1 ? "2026-08-26T10:05:00.000Z" : "2026-08-26T10:08:00.000Z",
    summary: "The artifact was evaluated against the application rubric.",
    independentReview: {
      authorLineage: "anthropic:author",
      criticLineage: "openai:critic",
      lineagesDistinct: true,
      required: true,
    },
    inputAssessment: { status: "complete", missingInputs: [] },
    evaluation: evaluation(),
    findings: [],
    ...overrides,
  } as IndependentReadinessReport;
}

function agreements(): ReadinessDimensionAgreement[] {
  return readinessDimensions.map((dimension) => ({
    dimension,
    status: "agreed",
    rationale: `The review agrees on ${dimension}.`,
  }));
}

function validationContext() {
  return {
    requirements: [],
    outputConstraints: { requiredSections: ["Summary"] },
  } as const;
}

const defaultLoop: ApplicationReadinessStoppingLoopContext = {
  round: 1,
  maxRounds: 3,
  stable: false,
  budgetExhausted: false,
  cancelled: false,
};

function input(
  currentArtifact: ReturnType<typeof artifact> = artifact(),
  currentReport: IndependentReadinessReport = report(currentArtifact),
  overrides: Partial<EvaluateApplicationReadinessStoppingDecisionInput> = {},
): EvaluateApplicationReadinessStoppingDecisionInput {
  return {
    artifact: currentArtifact,
    report: currentReport,
    deterministicValidationContext: validationContext(),
    agreements: agreements(),
    createdAt:
      currentArtifact.version === 1 ? "2026-08-26T10:10:00.000Z" : "2026-08-26T10:10:00.000Z",
    loopContext: defaultLoop,
    ...overrides,
  } as EvaluateApplicationReadinessStoppingDecisionInput;
}

function finding(
  id: string,
  severity: "error" | "warning",
  target: { kind: "claim"; id: string } = { kind: "claim", id: "claim-1" },
) {
  return {
    id,
    origin: "critic" as const,
    code: `finding-${id}`,
    category: "quality" as const,
    severity,
    rationale: `The review recorded ${id}.`,
    target,
    recommendedAction: "Review the finding before approval.",
    confidence: 0.8,
  };
}

function trace(
  status: "verified" | "overridden" | "missing" | "disagreement-preserved",
  disposition: "accept" | "reject" = "accept",
): AdjudicatedRevisionTrace {
  const accepted = disposition === "accept";
  const decision = {
    findingId: "finding-1",
    origin: "critic" as const,
    code: "review-finding",
    severity: "error" as const,
    target: { kind: "claim" as const, id: "claim-1" },
    recommendedAction: "Review the finding before approval.",
    rationale: "The author recorded a bounded adjudication rationale.",
    disposition,
    effectRequirement: accepted
      ? ("revision-required" as const)
      : ("disagreement-preserved" as const),
  };
  const effect =
    status === "overridden"
      ? {
          findingId: "finding-1",
          status,
          rationale: "The author recorded an explicit effect override.",
        }
      : { findingId: "finding-1", status };
  return {
    schemaVersion: 1,
    adjudication: {
      schemaVersion: 1,
      contextSnapshotId: "context-1",
      sourceReport: {
        schemaVersion: 1,
        createdAt: "2026-08-26T10:05:00.000Z",
        artifact: { id: "artifact-1", version: 1 },
      },
      sourceArtifact: { id: "artifact-1", version: 1 },
      createdAt: "2026-08-26T10:05:30.000Z",
      decisions: [decision],
    },
    revisedArtifact: { id: "artifact-2", version: 2, parentVersionId: "artifact-1" },
    createdAt: "2026-08-26T10:07:00.000Z",
    diff: {
      addedClaimIds: [],
      removedClaimIds: [],
      changedClaimIds: ["claim-1"],
      changedEvidenceClaimIds: [],
      addedSectionIds: [],
      removedSectionIds: [],
      changedSectionIds: [],
    },
    effects: [effect],
    valid: status !== "missing",
  } as AdjudicatedRevisionTrace;
}

describe("application-readiness stopping evaluator", () => {
  it("marks a complete artifact ready without claiming human approval", () => {
    const decision = evaluateApplicationReadinessStoppingDecision(input());

    expect(decision.applicationReady).toBe(true);
    expect(decision.shouldStop).toBe(true);
    expect(decision.stopReason).toBe("application-ready");
    expect(decision.bestAvailable).toBe(false);
    expect(decision.humanApprovalRequired).toBe(true);
    expect(decision.blockers).toEqual([]);
    expect(decision.deterministicChecks).toEqual([]);
    expect(decision.artifact).toEqual({
      id: "artifact-1",
      version: 1,
      createdAt: "2026-08-26T10:00:00.000Z",
      parentVersionId: null,
    });
    expect(decision.loopContext).toEqual(defaultLoop);
  });

  it("blocks incomplete inputs, a failed independent review, errors, thresholds, and disputes", () => {
    const currentReport = report(artifact(), {
      inputAssessment: { status: "incomplete", missingInputs: ["rubric"] },
      independentReview: {
        authorLineage: "anthropic:author",
        criticLineage: "anthropic:critic",
        lineagesDistinct: false,
        required: true,
      },
      findings: [finding("error", "error")],
      evaluation: {
        ...evaluation(),
        scores: readinessDimensions.map((dimension, index) => ({
          dimension,
          score: index === 0 ? 0.2 : 0.9,
          rationale: `The ${dimension} score is supported by the independent review.`,
        })),
        thresholdResults: readinessDimensions.map((dimension, index) => ({
          dimension,
          score: index === 0 ? 0.2 : 0.9,
          threshold: 0.8,
          meets: index !== 0,
        })),
        meetsRubric: false,
      },
    });
    const currentAgreements = agreements().map((agreement, index) =>
      index === 1 ? { ...agreement, status: "disputed" as const } : agreement,
    );
    const baseArtifact = artifact();
    const baseClaim = baseArtifact.claims[0];
    if (baseClaim === undefined) {
      throw new Error("artifact fixture is incomplete");
    }
    const currentArtifact = {
      ...baseArtifact,
      claims: [{ ...baseClaim, evidence: [] }],
    };
    const decision = evaluateApplicationReadinessStoppingDecision(
      input(currentArtifact, currentReport, { agreements: currentAgreements }),
    );

    expect(decision.applicationReady).toBe(false);
    expect(decision.blockers.map((blocker) => blocker.code)).toEqual([
      "deterministic-error",
      "disputed-dimension",
      "incomplete-report-inputs",
      "independent-review-incomplete",
      "report-error",
      "unmet-rubric-threshold",
    ]);
    expect(decision.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "deterministic-error", checkCode: "unsupported-claim" }),
        expect.objectContaining({ code: "report-error", findingId: "error" }),
        expect.objectContaining({ code: "unmet-rubric-threshold", dimension: "relevance" }),
        expect.objectContaining({ code: "disputed-dimension", dimension: "evidence" }),
      ]),
    );
  });

  it("keeps deterministic/report warnings and explicit trace effects as limitations", () => {
    const currentReport = report(artifact(2), {
      findings: [finding("warning", "warning")],
    });
    const decision = evaluateApplicationReadinessStoppingDecision(
      input(artifact(2), currentReport, {
        latestRevisionTrace: trace("overridden"),
        explicitGapRequirementIds: ["requirement-gap"],
        deterministicValidationContext: {
          requirements: [{ id: "requirement-gap", text: "cloud security", priority: "high" }],
          outputConstraints: { requiredSections: ["Summary"] },
        },
      }),
    );

    expect(decision.applicationReady).toBe(true);
    expect(decision.deterministicChecks).toEqual([
      {
        code: "explicit-gap",
        severity: "warning",
        category: "coverage",
        requirementId: "requirement-gap",
      },
    ]);
    expect(decision.limitations.map((limitation) => limitation.code)).toEqual([
      "deterministic-warning",
      "report-warning",
      "revision-effect-overridden",
    ]);
    expect(decision.bestAvailable).toBe(false);
  });

  it("accepts an explicit existing independence override but never implies approval", () => {
    const currentReport = report(artifact(), {
      independentReview: {
        authorLineage: "anthropic:author",
        criticLineage: "anthropic:author",
        lineagesDistinct: false,
        required: true,
        overrideRationale: "The configured local model is the approved review exception.",
      },
    });
    const decision = evaluateApplicationReadinessStoppingDecision(input(artifact(), currentReport));

    expect(decision.applicationReady).toBe(true);
    expect(decision.humanApprovalRequired).toBe(true);
  });

  it("blocks missing accepted effects but preserves valid and disagreement effects", () => {
    const currentArtifact = artifact(2);
    const currentReport = report(currentArtifact);
    const missing = evaluateApplicationReadinessStoppingDecision(
      input(currentArtifact, currentReport, { latestRevisionTrace: trace("missing") }),
    );
    expect(missing.blockers).toContainEqual(
      expect.objectContaining({ code: "missing-revision-effect", findingId: "finding-1" }),
    );

    const verified = evaluateApplicationReadinessStoppingDecision(
      input(currentArtifact, currentReport, { latestRevisionTrace: trace("verified") }),
    );
    expect(verified.blockers).not.toContainEqual(
      expect.objectContaining({ code: "missing-revision-effect" }),
    );

    const disagreement = evaluateApplicationReadinessStoppingDecision(
      input(currentArtifact, currentReport, {
        latestRevisionTrace: trace("disagreement-preserved", "reject"),
      }),
    );
    expect(disagreement.blockers).not.toContainEqual(
      expect.objectContaining({ code: "missing-revision-effect" }),
    );
    expect(disagreement.limitations).toContainEqual(
      expect.objectContaining({ code: "disagreement-preserved", findingId: "finding-1" }),
    );
  });

  it("enforces identity and chronology before producing a decision", () => {
    expect(() =>
      evaluateApplicationReadinessStoppingDecision(input(artifact(), report(artifact(2)))),
    ).toThrow();
    expect(() =>
      evaluateApplicationReadinessStoppingDecision(
        input(artifact(2), report(artifact(2), { createdAt: "2026-08-26T10:06:30.000Z" }), {
          latestRevisionTrace: trace("verified"),
        }),
      ),
    ).toThrow();
    expect(() =>
      evaluateApplicationReadinessStoppingDecision(
        input(artifact(2), report(artifact(2), { contextSnapshotId: "other-context" }), {
          latestRevisionTrace: trace("verified"),
        }),
      ),
    ).toThrow();
  });

  it("uses the reviewed stop-reason precedence and validates loop numbers", () => {
    const blockedReport = report(artifact(), {
      findings: [finding("error", "error")],
    });
    const evaluate = (loopContext: ApplicationReadinessStoppingLoopContext) =>
      evaluateApplicationReadinessStoppingDecision(
        input(artifact(), blockedReport, { loopContext }),
      );

    expect(
      evaluate({ ...defaultLoop, cancelled: true, budgetExhausted: true, stable: true, round: 3 })
        .stopReason,
    ).toBe("cancelled");
    expect(
      evaluate({ ...defaultLoop, budgetExhausted: true, stable: true, round: 3 }).stopReason,
    ).toBe("budget-exhausted");
    expect(evaluate({ ...defaultLoop, stable: true, round: 3 }).stopReason).toBe("max-rounds");
    expect(evaluate({ ...defaultLoop, stable: true, round: 2 }).stopReason).toBe(
      "stable-convergence",
    );
    expect(evaluate({ ...defaultLoop, round: 1 }).stopReason).toBe("continue");

    expect(() => evaluate({ ...defaultLoop, round: 0 })).toThrow();
    expect(() => evaluate({ ...defaultLoop, maxRounds: 0 })).toThrow();
  });

  it("returns deterministic, deeply immutable decisions and rejects hidden fields", () => {
    const first = evaluateApplicationReadinessStoppingDecision(input());
    const second = evaluateApplicationReadinessStoppingDecision(input());
    expect(first).toEqual(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.report)).toBe(true);
    expect(Object.isFrozen(first.agreements)).toBe(true);
    expect(Object.isFrozen(first.agreements[0])).toBe(true);
    expect(Object.isFrozen(first.blockers)).toBe(true);
    expect(Object.isFrozen(first.limitations)).toBe(true);

    expect(() =>
      evaluateApplicationReadinessStoppingDecision(
        input(artifact(), report(artifact(), { chainOfThought: "hidden reasoning" })),
      ),
    ).toThrow();
  });

  it("sorts deterministic checks and their limitations independently of validation input order", () => {
    const currentArtifact = artifact();
    const currentReport = report(currentArtifact);
    const decision = evaluateApplicationReadinessStoppingDecision(
      input(currentArtifact, currentReport, {
        explicitGapRequirementIds: ["requirement-z", "requirement-a"],
        deterministicValidationContext: {
          requirements: [
            { id: "requirement-z", text: "cloud security", priority: "high" },
            { id: "requirement-a", text: "distributed systems", priority: "high" },
          ],
          outputConstraints: { requiredSections: ["Summary"] },
        },
      }),
    );

    expect(decision.deterministicChecks.map((check) => check.requirementId)).toEqual([
      "requirement-a",
      "requirement-z",
    ]);
    expect(
      decision.limitations.map((limitation) =>
        limitation.code === "deterministic-warning" ? limitation.checkCode : undefined,
      ),
    ).toEqual(["explicit-gap", "explicit-gap"]);
    expect(
      decision.limitations.map((limitation) =>
        limitation.code === "deterministic-warning" ? limitation.requirementId : undefined,
      ),
    ).toEqual(["requirement-a", "requirement-z"]);
  });

  it("rejects legacy aliases instead of resolving them into the canonical object API", () => {
    const legacyInput = {
      ...input(),
      validationContext: validationContext(),
    } as unknown as EvaluateApplicationReadinessStoppingDecisionInput;
    expect(() => evaluateApplicationReadinessStoppingDecision(legacyInput)).toThrow(
      "Unknown stopping decision input field: validationContext",
    );
  });

  it("keeps the artifact projection and trace parent identity self-contained", () => {
    const currentArtifact = artifact(2);
    const currentReport = report(currentArtifact);
    const evaluated = evaluateApplicationReadinessStoppingDecision(
      input(currentArtifact, currentReport, { latestRevisionTrace: trace("verified") }),
    );
    expect(evaluated.artifact.parentVersionId).toBe("artifact-1");

    const altered = {
      ...evaluated,
      artifact: { ...evaluated.artifact, parentVersionId: "other-parent" },
    };
    expect(() => applicationReadinessStoppingDecisionSchema.parse(altered)).toThrow();
  });
});
