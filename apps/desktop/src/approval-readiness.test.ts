import { describe, expect, it } from "vitest";

import {
  isApplicationNotReadyFailure,
  normalizeApprovalReadiness,
  projectApprovalReadiness,
} from "./approval-readiness.js";

const artifact = { id: "artifact-1", version: 2 };

function decision(overrides: Record<string, unknown> = {}) {
  return {
    artifact,
    applicationReady: false,
    blockers: [{ code: "unmet-rubric-threshold", dimension: "relevance" }],
    report: {
      evaluation: {
        thresholdResults: [{ dimension: "relevance", score: 0, threshold: 0.8, meets: false }],
      },
      privateRationale: "must not cross the renderer boundary",
    },
    privateMetadata: "must not cross the renderer boundary",
    ...overrides,
  };
}

describe("application approval readiness projection", () => {
  it("projects rubric score only for the exact artifact and drops all other decision content", () => {
    expect(projectApprovalReadiness(decision(), artifact)).toEqual({
      artifactId: "artifact-1",
      artifactVersion: 2,
      applicationReady: false,
      blockers: [
        { code: "unmet-rubric-threshold", dimension: "relevance", score: 0, threshold: 0.8 },
      ],
    });
    expect(projectApprovalReadiness(decision(), { id: "artifact-1", version: 1 })).toBeNull();
    expect(projectApprovalReadiness(decision(), { id: "artifact-old", version: 2 })).toBeNull();
  });

  it("marks a decision overridden only when the exact approved artifact records an override", () => {
    const binding = {
      id: "artifact-1",
      version: 2,
      checksum: "a".repeat(64),
      readinessOverride: {
        rationale: "must not cross the renderer boundary",
        blockers: ["unmet-rubric-threshold"],
        createdAt: "2026-10-04T00:00:00.000Z",
      },
    };
    const projected = projectApprovalReadiness(decision(), artifact, binding);
    expect(projected).toMatchObject({ applicationReady: false, overridden: true });
    expect(JSON.stringify(projected)).not.toContain("renderer boundary");
    expect(
      projectApprovalReadiness(decision(), artifact, { ...binding, version: 1 }),
    ).not.toHaveProperty("overridden");
    expect(
      projectApprovalReadiness(decision(), artifact, { ...binding, readinessOverride: undefined }),
    ).not.toHaveProperty("overridden");
    expect(
      normalizeApprovalReadiness({
        artifactId: "artifact-1",
        artifactVersion: 2,
        applicationReady: true,
        blockers: [],
        overridden: true,
      }),
    ).toBeNull();
  });

  it("preserves ready decisions and rejects malformed or inconsistent renderer projections", () => {
    expect(
      projectApprovalReadiness(decision({ applicationReady: true, blockers: [] }), artifact),
    ).toEqual({
      artifactId: "artifact-1",
      artifactVersion: 2,
      applicationReady: true,
      blockers: [],
    });
    expect(
      normalizeApprovalReadiness({
        artifactId: "artifact-1",
        artifactVersion: 2,
        applicationReady: false,
        blockers: [
          { code: "unmet-rubric-threshold", dimension: "relevance", score: 0, threshold: 0.8 },
        ],
        rationale: "unbounded text",
      }),
    ).toBeNull();
    expect(
      normalizeApprovalReadiness({
        artifactId: "artifact-1",
        artifactVersion: 2,
        applicationReady: false,
        blockers: [
          {
            code: "unmet-rubric-threshold",
            dimension: "relevance",
            score: Number.NaN,
            threshold: 0.8,
          },
        ],
      }),
    ).toBeNull();
    expect(
      projectApprovalReadiness(
        decision({
          report: {
            evaluation: {
              thresholdResults: [
                { dimension: "relevance", score: 0.8, threshold: 0.8, meets: false },
              ],
            },
          },
        }),
        artifact,
      ),
    ).toBeNull();
  });

  it("recognizes only the exact lifecycle error generated from a blocked persisted decision", () => {
    const blocked = decision();
    expect(
      isApplicationNotReadyFailure(
        new Error("The current artifact is not application-ready (unmet-rubric-threshold)."),
        blocked,
      ),
    ).toBe(true);
    expect(isApplicationNotReadyFailure(new Error("another lifecycle failure"), blocked)).toBe(
      false,
    );
    expect(
      isApplicationNotReadyFailure(
        new Error("The current artifact is not application-ready (unmet-rubric-threshold)."),
        decision({ applicationReady: true }),
      ),
    ).toBe(false);
  });
});
