import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DesktopBridgeError } from "./native.js";
import { WorkspaceStartLayout } from "./workspace-start.js";
import {
  isNoWorkspaceRefusal,
  WorkspaceStartIntro,
  workspaceStartGuidance,
} from "./workspace-start-intro.js";

const form = {
  draft: { name: "draft-loop-workspace", maxRounds: 3 },
  busy: false,
  onDraftChange: () => undefined,
  onCreate: () => undefined,
  onCreateDemo: () => undefined,
  onOpen: () => undefined,
};

function startPage(error: string | null): string {
  return renderToStaticMarkup(
    <>
      <WorkspaceStartIntro navigation={false} error={error} />
      <WorkspaceStartLayout
        busy={false}
        form={form}
        recent={{
          workspaces: [],
          busy: false,
          loadState: "ready",
          errorMessage: null,
          statusMessage: null,
          openingId: null,
          onOpen: () => undefined,
          onClear: () => undefined,
        }}
      />
    </>,
  );
}

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

  it("leads a fresh start page with guidance and no host error", () => {
    const html = startPage(null);
    expect(html).toContain("Set up a review workspace");
    expect(html).toContain(workspaceStartGuidance);
    expect(html).toContain("create a workspace");
    expect(html).toContain("open a recent one");
    expect(html).toContain("try the demo");
    expect(html).not.toContain("Open a workspace first.");
    expect(html).not.toContain('role="alert"');
    expect(html.indexOf(workspaceStartGuidance)).toBeLessThan(
      html.indexOf('aria-label="Workspace name"'),
    );
  });

  it("still shows a genuine failure, after the guidance", () => {
    const html = startPage("The workspace could not be opened.");
    expect(html).toContain(
      '<p class="setup-blocker" role="alert">The workspace could not be opened.</p>',
    );
    expect(html.indexOf(workspaceStartGuidance)).toBeLessThan(
      html.indexOf("The workspace could not be opened."),
    );
  });

  it("titles the page for switching workspaces when one was open", () => {
    const html = renderToStaticMarkup(<WorkspaceStartIntro navigation error={null} />);
    expect(html).toContain("Workspace navigation");
    expect(html).toContain("Open or create a review workspace");
  });
});
