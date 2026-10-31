import type { ApprovalReadiness } from "@draft-loop/ui/approval-readiness";
import { describe, expect, it } from "vitest";

import { withAutopilotPause } from "./autopilot-pause.js";

const readiness: ApprovalReadiness = {
  artifactId: "artifact-1",
  artifactVersion: 2,
  applicationReady: false,
  blockers: [{ code: "report-error" }],
  stopReason: "continue",
};

describe("withAutopilotPause (#2013)", () => {
  it("marks the readiness when autopilot paused on a conflict", () => {
    expect(withAutopilotPause(readiness, { autopilotPause: "conflict" })).toEqual({
      ...readiness,
      stopReason: "autopilot-conflict",
    });
  });

  it("keeps the decision's reason for every other arrival, including older snapshots", () => {
    expect(withAutopilotPause(readiness, { autopilotPause: null })).toBe(readiness);
    expect(withAutopilotPause(readiness, {})).toBe(readiness);
  });

  it("cannot word a pause without a readiness to carry it", () => {
    expect(withAutopilotPause(null, { autopilotPause: "conflict" })).toBeNull();
  });
});
