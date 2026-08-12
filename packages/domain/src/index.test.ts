import { describe, expect, it } from "vitest";

import { createWorkspace, workflowStates } from "./index.js";

describe("domain scaffold", () => {
  it("creates a workspace in the collecting state", () => {
    expect(createWorkspace("example")).toEqual({ id: "example", state: "collecting" });
    expect(workflowStates).toContain("awaiting-approval");
  });
});
