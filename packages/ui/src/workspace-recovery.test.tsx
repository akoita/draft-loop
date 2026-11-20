import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { HostBridgeError } from "./native.js";
import {
  isWorkspaceContextCurrent,
  isWorkspaceContextLost,
  WorkspaceRecovery,
} from "./workspace-recovery.js";

describe("workspace recovery", () => {
  it("recognizes only a trusted not-found error for the active workspace", () => {
    expect(
      isWorkspaceContextLost(
        new HostBridgeError("not-found", "The workspace was not found."),
        "workspace-1",
        1,
        "workspace-1",
        1,
      ),
    ).toBe(true);
    expect(
      isWorkspaceContextLost(
        new HostBridgeError("not-found", "The workspace was not found."),
        "workspace-1",
        1,
        "workspace-2",
        1,
      ),
    ).toBe(false);
    expect(
      isWorkspaceContextLost(
        new HostBridgeError("operation-failed", "The operation failed."),
        "workspace-1",
        1,
        "workspace-1",
        1,
      ),
    ).toBe(false);
    expect(isWorkspaceContextLost(new Error("not found"), "workspace-1", 1, "workspace-1", 1)).toBe(
      false,
    );
    expect(
      isWorkspaceContextLost(
        new HostBridgeError("not-found", "The workspace was not found."),
        null,
        1,
        null,
        1,
      ),
    ).toBe(false);
    expect(isWorkspaceContextCurrent("workspace-1", 1, "workspace-1", 2)).toBe(false);
  });

  it("says the workspace is gone and offers no other action", () => {
    const html = renderToStaticMarkup(<WorkspaceRecovery errorMessage={null} />);

    expect(html).toContain("This workspace could not be found");
    expect(html).toContain("Reload the page to try again.");
    expect(html).not.toMatch(/<button\b/u);
    expect(html).not.toMatch(/(?:Start review|Approve|Export|model discovery)/iu);
  });
});
