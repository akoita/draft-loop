import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceTitleView } from "./workspace-title.js";

interface KeyEvent {
  readonly key: string;
  readonly preventDefault: () => void;
  readonly stopPropagation: () => void;
}

type Props = Parameters<typeof WorkspaceTitleView>[0];

const baseProps: Props = {
  name: "Mergify — Staff Engineer",
  editing: false,
  draft: "Mergify — Staff Engineer",
  busy: false,
  errorMessage: null,
  canRename: true,
  onStartEditing: () => undefined,
  onDraftChange: () => undefined,
  onSave: () => undefined,
  onCancel: () => undefined,
};

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (!isValidElement(node)) return [];
  const children = (node as ReactElement<{ readonly children?: ReactNode }>).props.children;
  return [
    node as ReactElement<Record<string, unknown>>,
    ...Children.toArray(children).flatMap(elements),
  ];
}

function find(
  view: ReactNode,
  predicate: (element: ReactElement<Record<string, unknown>>) => boolean,
): ReactElement<Record<string, unknown>> {
  const found = elements(view).find(predicate);
  if (found === undefined) throw new Error("Expected element was not rendered.");
  return found;
}

describe("workspace title rename control", () => {
  it("shows the name with an accessible Rename button that starts editing", () => {
    const onStartEditing = vi.fn();
    const view = WorkspaceTitleView({ ...baseProps, onStartEditing });
    const markup = renderToStaticMarkup(view);
    expect(markup).toContain("<h1");
    expect(markup).toContain("Mergify — Staff Engineer");
    expect(markup).toContain('aria-label="Rename workspace Mergify — Staff Engineer"');
    (find(view, (element) => element.type === "button").props.onClick as () => void)();
    expect(onStartEditing).toHaveBeenCalledOnce();
  });

  it("hides Rename when the host cannot rename", () => {
    const markup = renderToStaticMarkup(WorkspaceTitleView({ ...baseProps, canRename: false }));
    expect(markup).toContain("<h1");
    expect(markup).not.toContain("Rename");
  });

  it("edits in a labelled field with Save and Cancel, Enter submitting and Escape cancelling", () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    const view = WorkspaceTitleView({ ...baseProps, editing: true, onSave, onCancel });
    const markup = renderToStaticMarkup(view);
    expect(markup).toContain('aria-label="Workspace name"');
    expect(markup).toContain('value="Mergify — Staff Engineer"');
    expect(markup).toContain("Save");
    expect(markup).toContain("Cancel");
    expect(markup).not.toContain("<h1");

    const form = find(view, (element) => element.type === "form");
    const preventDefault = vi.fn();
    (form.props.onSubmit as (event: { preventDefault: () => void }) => void)({ preventDefault });
    expect(preventDefault).toHaveBeenCalled();
    expect(onSave).toHaveBeenCalledOnce();

    const input = find(view, (element) => element.type === "input");
    const keyDown = input.props.onKeyDown as (event: KeyEvent) => void;
    const escapeKey = { key: "Escape", preventDefault: vi.fn(), stopPropagation: vi.fn() };
    keyDown(escapeKey);
    expect(onCancel).toHaveBeenCalledOnce();
    keyDown({ ...escapeKey, key: "a" });
    expect(onCancel).toHaveBeenCalledOnce();

    const cancel = find(
      view,
      (element) => element.type === "button" && element.props.type === "button",
    );
    (cancel.props.onClick as () => void)();
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it("shows a validation message as an alert tied to the field and locks the controls while busy", () => {
    const markup = renderToStaticMarkup(
      WorkspaceTitleView({
        ...baseProps,
        editing: true,
        busy: true,
        errorMessage: "Enter a name of 1 to 80 characters without slashes or control characters.",
      }),
    );
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("1 to 80 characters");
    expect(markup).toContain('aria-invalid="true"');
    expect(markup).toContain('aria-describedby="workspace-title-error"');
    expect(markup.match(/disabled=""/gu)).toHaveLength(3);
  });
});
