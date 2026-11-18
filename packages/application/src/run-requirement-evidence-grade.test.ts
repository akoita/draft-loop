import { describe, expect, it, vi } from "vitest";

import { applyRequirementEvidenceGrades } from "./requirement-evidence-grade.js";
import {
  requirementEvidenceGradeAuditPayload,
  requirementEvidenceGradeEnabled,
  runRequirementEvidenceGradeHook,
} from "./run-requirement-evidence-grade.js";

const map = {
  mode: "keyword" as const,
  reason: "no-model" as const,
  chunkCount: 1,
  entries: [{ requirementId: "r1", candidates: [{ chunkId: "c1", origin: "keyword" as const }] }],
};

const retrieval = {
  requirementEvidenceMap: async () => map,
  fullSourceEvidence: async () => [],
};

describe("run requirement-evidence grade", () => {
  it("is off unless the setting says on", () => {
    expect(requirementEvidenceGradeEnabled({})).toBe(false);
    expect(requirementEvidenceGradeEnabled({ DRAFT_LOOP_EVIDENCE_GRADE: "off" })).toBe(false);
    expect(requirementEvidenceGradeEnabled({ DRAFT_LOOP_EVIDENCE_GRADE: " ON " })).toBe(true);
  });

  it("gives a run no hook when off or without a map", () => {
    const storage = { appendAuditEvent: vi.fn() };
    expect(runRequirementEvidenceGradeHook(retrieval, storage, "w", false)).toBeUndefined();
    expect(runRequirementEvidenceGradeHook(undefined, storage, "w", true)).toBeUndefined();
    expect(runRequirementEvidenceGradeHook({}, storage, "w", true)).toBeUndefined();
  });

  it("records grades by id in run history, never the reasons", async () => {
    const appendAuditEvent = vi.fn(async (input: unknown) => input as never);
    const hook = runRequirementEvidenceGradeHook(retrieval, { appendAuditEvent }, "w", true);
    const graded = applyRequirementEvidenceGrades(map, [
      { requirementId: "r1", chunkId: "c1", grade: "partly-supports", reason: "Secret reason." },
    ]);
    await hook?.record("run-1", graded);
    const event = appendAuditEvent.mock.calls[0]?.[0] as { payload: unknown };
    expect(event).toMatchObject({
      eventType: "run.requirement-evidence-grade",
      entityId: "run-1",
      workspaceId: "w",
      payload: {
        status: "graded",
        gradedPairs: 1,
        partlySupports: 1,
        entries: [{ requirementId: "r1", grades: [{ chunkId: "c1", grade: "partly-supports" }] }],
      },
    });
    expect(JSON.stringify(event.payload)).not.toContain("Secret reason.");
    expect(
      requirementEvidenceGradeAuditPayload(applyRequirementEvidenceGrades(map, undefined)),
    ).toMatchObject({ status: "failed", gradedPairs: 0 });
  });
});
