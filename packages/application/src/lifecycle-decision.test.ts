import type { RunSnapshot } from "@draft-loop/orchestrator";
import { describe, expect, it } from "vitest";

import { lifecycleDecisionRecord } from "./lifecycle-decision.js";

function snapshot(approvedArtifact: RunSnapshot["approvedArtifact"]): RunSnapshot {
  return { approvedArtifact } as RunSnapshot;
}

describe("lifecycle decision record", () => {
  it("records a final-check override with its blockers and reason", () => {
    const record = lifecycleDecisionRecord(
      "approve",
      snapshot({
        id: "artifact-1",
        version: 3,
        checksum: "a".repeat(64),
        readinessOverride: {
          rationale: "Checked coverage by hand.",
          blockers: ["unmet-rubric-threshold", "disputed-dimension"],
          createdAt: "2026-10-04T00:00:00.000Z",
        },
      }),
    );

    expect(record).toEqual({
      rationale:
        "Approved past failing final CV checks (unmet-rubric-threshold, disputed-dimension): Checked coverage by hand.",
      payload: { action: "approve", source: "cli", readinessOverride: true },
    });
  });

  it("keeps the plain approval and revision records unchanged", () => {
    const binding = { id: "artifact-1", version: 3, checksum: "a".repeat(64) };
    expect(lifecycleDecisionRecord("approve", snapshot(binding))).toEqual({
      rationale: "Approved through the explicit CLI approval command.",
      payload: { action: "approve", source: "cli" },
    });
    expect(lifecycleDecisionRecord("revision", snapshot(null)).rationale).toBe(
      "Revision requested through the explicit CLI command.",
    );
  });
});
