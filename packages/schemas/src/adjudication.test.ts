import { describe, expect, it } from "vitest";

import {
  adjudicatedRevisionEffectSchema,
  adjudicatedRevisionTraceSchema,
  artifactDiffSchema,
  authorAdjudicationDecisionInputSchema,
  authorAdjudicationPlanSchema,
} from "./index.js";

function decision(overrides: Record<string, unknown> = {}) {
  return {
    findingId: "finding-1",
    origin: "deterministic",
    code: "claim-change",
    severity: "error",
    target: { kind: "claim", id: "claim-1" },
    recommendedAction: "Update the claim from the supplied evidence.",
    rationale: "The author reviewed the finding and accepts the requested change.",
    disposition: "accept",
    effectRequirement: "revision-required",
    ...overrides,
  };
}

function plan(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    contextSnapshotId: "context-1",
    sourceReport: {
      schemaVersion: 1,
      createdAt: "2026-08-25T10:00:00.000Z",
      artifact: { id: "artifact-1", version: 1 },
    },
    sourceArtifact: { id: "artifact-1", version: 1 },
    createdAt: "2026-08-25T10:05:00.000Z",
    decisions: [decision()],
    ...overrides,
  };
}

function diff(overrides: Record<string, unknown> = {}) {
  return {
    addedClaimIds: [],
    removedClaimIds: [],
    changedClaimIds: [],
    changedEvidenceClaimIds: [],
    addedSectionIds: [],
    removedSectionIds: [],
    changedSectionIds: [],
    ...overrides,
  };
}

function trace(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    adjudication: plan(),
    revisedArtifact: { id: "artifact-2", version: 2, parentVersionId: "artifact-1" },
    createdAt: "2026-08-25T10:06:00.000Z",
    diff: diff(),
    effects: [{ findingId: "finding-1", status: "verified" }],
    valid: true,
    ...overrides,
  };
}

describe("author adjudication and revision trace schemas", () => {
  it("parses strict decision inputs and bounded rationales", () => {
    expect(
      authorAdjudicationDecisionInputSchema.parse({
        findingId: "finding-1",
        disposition: "accept",
        rationale: "Accept the finding and revise the claim.",
      }),
    ).toEqual({
      findingId: "finding-1",
      disposition: "accept",
      rationale: "Accept the finding and revise the claim.",
    });
    expect(
      authorAdjudicationDecisionInputSchema.safeParse({
        findingId: "finding-1",
        disposition: "accept",
        rationale: " ",
      }).success,
    ).toBe(false);
    expect(
      authorAdjudicationDecisionInputSchema.safeParse({
        findingId: "finding-1",
        disposition: "accept",
        rationale: "r".repeat(501),
      }).success,
    ).toBe(false);
  });

  it("rejects contradictory plan dispositions and effect requirements", () => {
    expect(
      authorAdjudicationPlanSchema.safeParse(
        plan({
          decisions: [decision({ disposition: "reject", effectRequirement: "revision-required" })],
        }),
      ).success,
    ).toBe(false);
    expect(
      authorAdjudicationPlanSchema.safeParse(
        plan({
          decisions: [
            decision({ disposition: "accept", effectRequirement: "disagreement-preserved" }),
          ],
        }),
      ).success,
    ).toBe(false);
  });

  it("rejects duplicate decision ids and contradictory source identities", () => {
    expect(
      authorAdjudicationPlanSchema.safeParse(
        plan({ decisions: [decision(), decision({ origin: "critic" })] }),
      ).success,
    ).toBe(false);
    expect(
      authorAdjudicationPlanSchema.safeParse(
        plan({ sourceArtifact: { id: "artifact-other", version: 1 } }),
      ).success,
    ).toBe(false);
  });

  it("rejects plans and traces with backwards chronology", () => {
    expect(
      authorAdjudicationPlanSchema.safeParse(plan({ createdAt: "2026-08-25T09:59:00.000Z" }))
        .success,
    ).toBe(false);
    expect(
      adjudicatedRevisionTraceSchema.safeParse(trace({ createdAt: "2026-08-25T10:04:00.000Z" }))
        .success,
    ).toBe(false);
  });

  it("requires trace validity to agree with missing effects", () => {
    expect(adjudicatedRevisionTraceSchema.safeParse(trace()).success).toBe(true);
    expect(
      adjudicatedRevisionTraceSchema.safeParse(
        trace({ effects: [{ findingId: "finding-1", status: "missing" }], valid: true }),
      ).success,
    ).toBe(false);
    expect(
      adjudicatedRevisionTraceSchema.safeParse(
        trace({ effects: [{ findingId: "finding-1", status: "missing" }], valid: false }),
      ).success,
    ).toBe(true);
    expect(
      adjudicatedRevisionEffectSchema.safeParse({
        findingId: "finding-1",
        status: "overridden",
      }).success,
    ).toBe(false);
  });

  it("requires unique non-empty diff and effect ids", () => {
    expect(
      artifactDiffSchema.safeParse(diff({ changedClaimIds: ["claim-1", "claim-1"] })).success,
    ).toBe(false);
    expect(
      adjudicatedRevisionTraceSchema.safeParse(
        trace({
          effects: [
            { findingId: "finding-1", status: "verified" },
            { findingId: "finding-1", status: "disagreement-preserved" },
          ],
          valid: true,
        }),
      ).success,
    ).toBe(false);
    expect(
      adjudicatedRevisionTraceSchema.safeParse(trace({ diff: diff({ addedSectionIds: [" "] }) }))
        .success,
    ).toBe(false);
  });

  it("rejects contradictory claim and section diff sets", () => {
    expect(
      artifactDiffSchema.safeParse(
        diff({ addedClaimIds: ["claim-1"], changedClaimIds: ["claim-1"] }),
      ).success,
    ).toBe(false);
    expect(
      artifactDiffSchema.safeParse(
        diff({ removedClaimIds: ["claim-1"], changedEvidenceClaimIds: ["claim-1"] }),
      ).success,
    ).toBe(false);
    expect(
      artifactDiffSchema.safeParse(
        diff({ addedSectionIds: ["section-1"], removedSectionIds: ["section-1"] }),
      ).success,
    ).toBe(false);
    expect(
      artifactDiffSchema.safeParse(
        diff({ changedSectionIds: ["section-1"], removedSectionIds: ["section-1"] }),
      ).success,
    ).toBe(false);
    expect(
      artifactDiffSchema.safeParse(
        diff({ changedClaimIds: ["claim-1"], changedEvidenceClaimIds: ["claim-1"] }),
      ).success,
    ).toBe(true);
  });

  it("requires effect ids and statuses to agree with adjudication decisions", () => {
    expect(
      adjudicatedRevisionTraceSchema.safeParse(
        trace({ effects: [{ findingId: "finding-unknown", status: "verified" }], valid: true }),
      ).success,
    ).toBe(false);
    expect(
      adjudicatedRevisionTraceSchema.safeParse(
        trace({
          effects: [{ findingId: "finding-1", status: "disagreement-preserved" }],
          valid: true,
        }),
      ).success,
    ).toBe(false);
    expect(
      adjudicatedRevisionTraceSchema.safeParse(
        trace({
          adjudication: plan({
            decisions: [
              decision({
                disposition: "reject",
                effectRequirement: "disagreement-preserved",
              }),
            ],
          }),
          effects: [{ findingId: "finding-1", status: "verified" }],
          valid: true,
        }),
      ).success,
    ).toBe(false);
  });

  it("rejects provider payloads and hidden reasoning fields", () => {
    expect(
      authorAdjudicationPlanSchema.safeParse(plan({ chainOfThought: "hidden reasoning" })).success,
    ).toBe(false);
    expect(
      authorAdjudicationPlanSchema.safeParse(
        plan({ decisions: [decision({ rawResponse: "provider payload" })] }),
      ).success,
    ).toBe(false);
    expect(
      adjudicatedRevisionTraceSchema.safeParse(trace({ rawPrompt: "provider prompt" })).success,
    ).toBe(false);
    expect(
      adjudicatedRevisionTraceSchema.safeParse(
        trace({ diff: diff({ rawResponse: "provider payload" }) }),
      ).success,
    ).toBe(false);
  });
});
