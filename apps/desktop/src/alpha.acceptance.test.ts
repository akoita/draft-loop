import { describe, expect, it } from "vitest";

import {
  createFixtureReviewPort,
  createFixtureReviewState,
  type DesktopReviewState,
} from "./model.js";

describe("integrated local alpha review contract", () => {
  it("preserves review decisions through approval and local export", async () => {
    const port = createFixtureReviewPort();
    const loaded = await port.load();
    expect(loaded.state).toBe("paused");

    const resumed = await port.dispatch(loaded, { type: "resume" });
    expect(resumed.state).toBe("reviewing");

    const awaitingApproval: DesktopReviewState = {
      ...resumed,
      state: "awaiting-approval",
      findings: resumed.findings.map((finding) => ({
        ...finding,
        decision: finding.severity === "error" ? "overridden" : finding.decision,
      })),
    };
    const approved = await port.dispatch(awaitingApproval, { type: "approve" });
    expect(approved.state).toBe("approved");
    expect(approved.approval).toBe("approved");

    const exported = await port.dispatch(approved, { type: "export" });
    expect(exported.state).toBe("exported");
    expect(exported.exportPath).toBe("exports/run-demo-1.md");
  });

  it("keeps the blocking factuality gate intact", async () => {
    const port = createFixtureReviewPort();
    const initial = createFixtureReviewState();
    const awaitingApproval: DesktopReviewState = {
      ...initial,
      state: "awaiting-approval",
    };

    const blocked = await port.dispatch(awaitingApproval, { type: "approve" });
    expect(blocked.state).toBe("awaiting-approval");
    expect(blocked.approval).toBe("pending");
  });
});
