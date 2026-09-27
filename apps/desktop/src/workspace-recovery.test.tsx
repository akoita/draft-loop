import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { DesktopBridgeError } from "./native.js";
import {
  isWorkspaceContextCurrent,
  isWorkspaceContextLost,
  WorkspaceRecovery,
} from "./workspace-recovery.js";

describe("workspace recovery", () => {
  it("recognizes only a trusted not-found error for the active workspace", () => {
    expect(
      isWorkspaceContextLost(
        new DesktopBridgeError("not-found", "The workspace was not found."),
        "workspace-1",
        1,
        "workspace-1",
        1,
      ),
    ).toBe(true);
    expect(
      isWorkspaceContextLost(
        new DesktopBridgeError("not-found", "The workspace was not found."),
        "workspace-1",
        1,
        "workspace-2",
        1,
      ),
    ).toBe(false);
    expect(
      isWorkspaceContextLost(
        new DesktopBridgeError("operation-failed", "The operation failed."),
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
        new DesktopBridgeError("not-found", "The workspace was not found."),
        null,
        1,
        null,
        1,
      ),
    ).toBe(false);
    expect(isWorkspaceContextCurrent("workspace-1", 1, "workspace-1", 2)).toBe(false);
  });

  it("offers only explicit workspace recovery controls", () => {
    const onOpen = vi.fn();
    const html = renderToStaticMarkup(
      <WorkspaceRecovery busy={false} errorMessage={null} onOpen={onOpen} />,
    );

    expect(html).toContain("Open workspace");
    expect(html).toContain("Open a workspace to resume local review.");
    expect(html.match(/<button\b/gu)).toHaveLength(1);
    expect(html).not.toMatch(/(?:Start review|Approve|Export|model discovery)/iu);
    expect(onOpen).not.toHaveBeenCalled();
  });
});
