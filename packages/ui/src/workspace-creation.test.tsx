import { isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceCreationForm, workspaceCreationSubmission } from "./workspace-creation.js";

describe("desktop workspace creation", () => {
  it("collects only the name and round limit before workspace creation", () => {
    const html = renderToStaticMarkup(
      <WorkspaceCreationForm
        draft={{ name: "New workspace", maxRounds: 4 }}
        busy={false}
        onDraftChange={() => undefined}
        onCreate={() => undefined}
        onOpen={() => undefined}
        onCreateDemo={() => undefined}
      />,
    );

    expect(html).toContain('aria-label="Workspace name"');
    expect(html).toContain('aria-label="Maximum review rounds"');
    expect(html).not.toContain("Author model");
    expect(html).not.toContain("Critic model");
    expect(html).not.toContain("independence");
    expect(html).toContain("Open workspace");
    expect(html).toContain("Try demo workspace");
  });

  it("submits the trimmed name and only the selected round limit", () => {
    const onCreate = vi.fn();
    const element = WorkspaceCreationForm({
      draft: { name: "  planning  ", maxRounds: 6 },
      busy: false,
      onDraftChange: () => undefined,
      onCreate,
    });
    expect(isValidElement(element)).toBe(true);
    if (!isValidElement(element)) throw new Error("Expected a workspace creation form.");
    const form = element as ReactElement<{
      readonly onSubmit: (event: { preventDefault: () => void }) => void;
    }>;
    const preventDefault = vi.fn();
    form.props.onSubmit({ preventDefault });

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(onCreate).toHaveBeenCalledWith("planning", 6);
    expect(workspaceCreationSubmission(" planning ", 6)).toEqual({
      name: "planning",
      selection: { maxRounds: 6 },
    });
    expect(workspaceCreationSubmission(" planning ", 6).selection).not.toHaveProperty(
      "authorModel",
    );
  });

  it("blocks invalid rounds or a blank name without invoking create", () => {
    const onCreate = vi.fn();
    for (const draft of [
      { name: "Workspace", maxRounds: 0 },
      { name: "Workspace", maxRounds: 21 },
      { name: "   ", maxRounds: 3 },
    ]) {
      const element = WorkspaceCreationForm({
        draft,
        busy: false,
        onDraftChange: () => undefined,
        onCreate,
      });
      if (!isValidElement(element)) throw new Error("Expected a workspace creation form.");
      const form = element as ReactElement<{
        readonly onSubmit: (event: { preventDefault: () => void }) => void;
      }>;
      form.props.onSubmit({ preventDefault: () => undefined });
    }
    expect(onCreate).not.toHaveBeenCalled();
  });
});
