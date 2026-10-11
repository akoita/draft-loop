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
  onCommit: () => undefined,
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
  it("edits the name in place from a double-click or the accessible pencil, with no Rename button", () => {
    const onStartEditing = vi.fn();
    const view = WorkspaceTitleView({ ...baseProps, onStartEditing });
    const markup = renderToStaticMarkup(view);
    expect(markup).toContain("<h1");
    expect(markup).toContain("Mergify — Staff Engineer");
    expect(markup).toContain('aria-label="Rename workspace Mergify — Staff Engineer"');
    expect(markup).not.toContain(">Rename<");
    expect(markup).toContain("<svg");

    (find(view, (element) => element.type === "h1").props.onDoubleClick as () => void)();
    (find(view, (element) => element.type === "button").props.onClick as () => void)();
    expect(onStartEditing).toHaveBeenCalledTimes(2);
  });

  it("shows a plain heading when the host cannot rename", () => {
    const view = WorkspaceTitleView({ ...baseProps, canRename: false });
    const markup = renderToStaticMarkup(view);
    expect(markup).toContain("<h1");
    expect(markup).not.toContain("Rename");
    expect(find(view, (element) => element.type === "h1").props.onDoubleClick).toBeUndefined();
  });

  it("edits in a labelled field where Enter saves, Escape cancels and leaving commits", () => {
    const onSave = vi.fn();
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    const view = WorkspaceTitleView({ ...baseProps, editing: true, onSave, onCommit, onCancel });
    const markup = renderToStaticMarkup(view);
    expect(markup).toContain('aria-label="Workspace name"');
    expect(markup).toContain('value="Mergify — Staff Engineer"');
    expect(markup).not.toContain("Save");
    expect(markup).not.toContain("Cancel");
    expect(markup).not.toContain("<h1");

    const input = find(view, (element) => element.type === "input");
    const keyDown = input.props.onKeyDown as (event: KeyEvent) => void;
    const enterKey = { key: "Enter", preventDefault: vi.fn(), stopPropagation: vi.fn() };
    keyDown(enterKey);
    expect(enterKey.preventDefault).toHaveBeenCalled();
    expect(onSave).toHaveBeenCalledOnce();

    keyDown({ ...enterKey, key: "Escape" });
    expect(onCancel).toHaveBeenCalledOnce();
    keyDown({ ...enterKey, key: "a" });
    expect(onSave).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledOnce();

    (input.props.onBlur as () => void)();
    expect(onCommit).toHaveBeenCalledOnce();
  });

  it("shows a validation message as an alert tied to the field and ignores keys while busy", () => {
    const onSave = vi.fn();
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    const view = WorkspaceTitleView({
      ...baseProps,
      editing: true,
      busy: true,
      errorMessage: "Enter a name of 1 to 80 characters without slashes or control characters.",
      onSave,
      onCommit,
      onCancel,
    });
    const markup = renderToStaticMarkup(view);
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("1 to 80 characters");
    expect(markup).toContain('aria-invalid="true"');
    expect(markup).toContain('aria-describedby="workspace-title-error"');
    expect(markup).toContain("readOnly");

    const input = find(view, (element) => element.type === "input");
    const keyDown = input.props.onKeyDown as (event: KeyEvent) => void;
    keyDown({ key: "Enter", preventDefault: vi.fn(), stopPropagation: vi.fn() });
    keyDown({ key: "Escape", preventDefault: vi.fn(), stopPropagation: vi.fn() });
    (input.props.onBlur as () => void)();
    expect(onSave).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });
});
