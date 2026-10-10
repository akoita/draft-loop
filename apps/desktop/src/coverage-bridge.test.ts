import { describe, expect, it } from "vitest";

import { createCapabilityPort, type NativeBridge } from "./bridge.js";
import type { ReviewCoverageView } from "./coverage-contract.js";
import { createFixtureReviewState } from "./model.js";

/*
 * Drift proof: a real coverage payload goes through the real review-state validator, so a field
 * added to the interface but not to the runtime allowlist fails here instead of in the app.
 */

const coverage: ReviewCoverageView = {
  instructionsVersion: "coverage-judgement-v1",
  summary: { judged: 2, satisfied: 1, notSatisfied: 1, invalid: 0, unanswered: 0 },
  assessments: [
    {
      requirementId: "req-1",
      status: "covered",
      basis: "judgement",
      evidence: [{ blockId: "block-1" }],
      rationale: "The block names the tool and the outcome.",
    },
    {
      requirementId: "req-2",
      requirementText: "Experience in CI/CD and Infra as Code (Terraform)",
      status: "uncovered",
      basis: "judgement",
      evidence: [],
      rationale: "No block shows the skill.",
    },
  ],
};

function loadReview(value: unknown) {
  const fixture = createFixtureReviewState();
  const bridge: NativeBridge = {
    capabilities: ["review.load"],
    invoke: async () => ({ ok: true, value }) as never,
  };
  return createCapabilityPort(bridge).execute({
    type: "review.load",
    input: { workspaceId: fixture.workspaceId },
  });
}

describe("review state coverage over the bridge", () => {
  it("accepts a real coverage payload unchanged", async () => {
    const state = { ...createFixtureReviewState(), coverage };
    await expect(loadReview(state)).resolves.toEqual({ ok: true, value: state });
  });

  it("accepts null coverage and a state that predates the field", async () => {
    const fixture = createFixtureReviewState();
    await expect(loadReview({ ...fixture, coverage: null })).resolves.toEqual({
      ok: true,
      value: { ...fixture, coverage: null },
    });
    await expect(loadReview(fixture)).resolves.toEqual({ ok: true, value: fixture });
  });

  it("rejects requirement text that is empty or carries control characters", async () => {
    for (const requirementText of ["", "   ", "Terraform\u0007", "x".repeat(2_001)]) {
      const assessments = coverage.assessments.map((assessment, index) =>
        index === 0 ? { ...assessment, requirementText } : assessment,
      );
      await expect(
        loadReview({ ...createFixtureReviewState(), coverage: { ...coverage, assessments } }),
      ).resolves.toMatchObject({ ok: false });
    }
  });

  it("rejects an unexpected key at every level", async () => {
    const fixture = createFixtureReviewState();
    const [first] = coverage.assessments;
    const malformed: readonly unknown[] = [
      { ...coverage, requirementText: "leaks text" },
      { ...coverage, summary: { ...coverage.summary, path: "/home/user" } },
      { ...coverage, assessments: [{ ...first, score: 0.9 }] },
      { ...coverage, assessments: [{ ...first, evidence: [{ blockId: "b", score: 0.9 }] }] },
    ];
    for (const value of malformed) {
      await expect(loadReview({ ...fixture, coverage: value })).resolves.toMatchObject({
        ok: false,
        error: { code: "operation-failed" },
      });
    }
  });

  it("rejects values outside the status, basis, count, and size contracts", async () => {
    const fixture = createFixtureReviewState();
    const [first] = coverage.assessments;
    const malformed: readonly unknown[] = [
      { ...coverage, assessments: [{ ...first, status: "satisfied" }] },
      { ...coverage, assessments: [{ ...first, basis: "guess" }] },
      { ...coverage, assessments: [{ ...first, rationale: "" }] },
      { ...coverage, assessments: [{ ...first, rationale: "x".repeat(1_001) }] },
      { ...coverage, summary: { ...coverage.summary, judged: -1 } },
      { ...coverage, summary: { ...coverage.summary, judged: 1.5 } },
      { ...coverage, instructionsVersion: 3 },
      { ...coverage, assessments: "none" },
      "covered",
    ];
    for (const value of malformed) {
      await expect(loadReview({ ...fixture, coverage: value })).resolves.toMatchObject({
        ok: false,
        error: { code: "operation-failed" },
      });
    }
  });
});
