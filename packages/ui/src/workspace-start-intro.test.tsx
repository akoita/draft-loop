import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DesktopBridgeError } from "./native.js";
import { isNoWorkspaceRefusal, WorkspaceStartIntro } from "./workspace-start-intro.js";

describe("start page intro", () => {
  it("treats only the host's no-workspace refusal as the start page's normal state", () => {
    expect(
      isNoWorkspaceRefusal(new DesktopBridgeError("not-found", "Open a workspace first.")),
    ).toBe(true);
    expect(
      isNoWorkspaceRefusal(new DesktopBridgeError("not-found", "Application not found.")),
    ).toBe(false);
    expect(
      isNoWorkspaceRefusal(new DesktopBridgeError("operation-failed", "Open a workspace first.")),
    ).toBe(false);
    expect(isNoWorkspaceRefusal(new Error("Open a workspace first."))).toBe(false);
    expect(isNoWorkspaceRefusal("Open a workspace first.")).toBe(false);
  });

  it("says the workspace did not load and how to retry, without a host error", () => {
    const html = renderToStaticMarkup(<WorkspaceStartIntro error={null} />);
    expect(html).toContain("The review workspace could not load.");
    expect(html).toContain("Reload the page to try again.");
    expect(html).not.toContain('role="alert"');
  });

  it("shows a genuine failure after the heading", () => {
    const html = renderToStaticMarkup(
      <WorkspaceStartIntro error="The workspace could not be opened." />,
    );
    expect(html).toContain(
      '<p class="setup-blocker" role="alert">The workspace could not be opened.</p>',
    );
  });
});
