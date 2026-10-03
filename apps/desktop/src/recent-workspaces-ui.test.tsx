import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { RecentWorkspacesView } from "./recent-workspaces-ui.js";

const workspaces = [
  {
    id: "123e4567-e89b-12d3-a456-426614174000",
    name: "Candidate workspace",
    lastOpenedAt: "2026-10-03T10:00:00.000Z",
  },
];

function elements(node: ReactNode): ReactElement[] {
  if (!isValidElement(node)) return [];
  const children = (node as ReactElement<{ readonly children?: ReactNode }>).props.children;
  return [node, ...Children.toArray(children).flatMap(elements)];
}

describe("recent workspace start-page controls", () => {
  it("shows bounded labels and opens only the selected opaque entry id", () => {
    const onOpen = vi.fn();
    const element = RecentWorkspacesView({
      workspaces,
      busy: false,
      loadState: "ready",
      errorMessage: null,
      statusMessage: null,
      openingId: null,
      onOpen,
      onClear: () => undefined,
    });
    const markup = renderToStaticMarkup(element);
    expect(markup).toContain("Candidate workspace");
    expect(markup).toContain("Last opened");
    expect(markup).not.toContain("/tmp/");
    const open = elements(element).find(
      (candidate) =>
        (candidate.props as { readonly className?: string }).className ===
        "button button-quiet recent-workspace-open",
    ) as ReactElement<{ readonly onClick: () => void }> | undefined;
    if (open === undefined) throw new Error("Expected a recent workspace button.");
    open.props.onClick();
    expect(onOpen).toHaveBeenCalledWith(workspaces[0]?.id);
  });

  it("disables selection while busy and gives fixed loading, empty, and failure feedback", () => {
    const onClear = vi.fn();
    const busy = RecentWorkspacesView({
      workspaces,
      busy: true,
      loadState: "ready",
      errorMessage: null,
      statusMessage: null,
      openingId: null,
      onOpen: () => undefined,
      onClear,
    });
    const open = elements(busy).find(
      (candidate) =>
        (candidate.props as { readonly className?: string }).className ===
        "button button-quiet recent-workspace-open",
    );
    expect(open?.props).toMatchObject({ disabled: true });

    const loading = renderToStaticMarkup(
      RecentWorkspacesView({
        workspaces: [],
        busy: false,
        loadState: "loading",
        errorMessage: null,
        statusMessage: null,
        openingId: null,
        onOpen: () => undefined,
        onClear,
      }),
    );
    expect(loading).toContain("Loading recent workspaces");
    const empty = renderToStaticMarkup(
      RecentWorkspacesView({
        workspaces: [],
        busy: false,
        loadState: "ready",
        errorMessage: null,
        statusMessage: null,
        openingId: null,
        onOpen: () => undefined,
        onClear,
      }),
    );
    expect(empty).toContain("No recent workspaces yet.");
    const failure = renderToStaticMarkup(
      RecentWorkspacesView({
        workspaces: [],
        busy: false,
        loadState: "ready",
        errorMessage: "Recent workspaces could not be loaded.",
        statusMessage: null,
        openingId: null,
        onOpen: () => undefined,
        onClear,
      }),
    );
    expect(failure).toContain("Recent workspaces could not be loaded.");

    const opening = RecentWorkspacesView({
      workspaces,
      busy: false,
      loadState: "ready",
      errorMessage: null,
      statusMessage: null,
      openingId: workspaces[0]?.id ?? null,
      onOpen: () => undefined,
      onClear,
    });
    const clear = elements(opening).find(
      (candidate) =>
        (candidate.props as { readonly children?: ReactNode }).children ===
        "Clear recent workspaces",
    );
    expect(clear?.props).toMatchObject({ disabled: true });
  });
});
