import { Children, createRef, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  candidateProfilePendingBlockerMessage,
  candidateProfileStartDisabledReason,
} from "./main.js";
import {
  runWorkspaceCloseIfAllowed,
  suppressWorkspaceDialogShortcut,
  type WorkspaceCloseGuard,
  WorkspaceNavigationContent,
  workspaceCloseDisabledReason,
} from "./workspace-navigation.js";

const available: WorkspaceCloseGuard = {
  busy: false,
  knowledgePending: false,
  pendingReviewAction: false,
  profilePending: false,
  running: false,
};

const pendingMessage =
  "Wait for the current workspace operation to finish before closing the workspace.";

function elements(node: ReactNode): ReactElement[] {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement(child)) return [];
    const props = child.props as { readonly children?: ReactNode };
    return [child, ...elements(props.children)];
  });
}

function button(node: ReactNode, label: string, occurrence = 0): ReactElement {
  const matches = elements(node).filter((element) => {
    if (element.type !== "button") return false;
    // A button's text sits beside its icon, so match the label among its children.
    const children = (element.props as { readonly children?: ReactNode }).children;
    return Children.toArray(children).includes(label);
  });
  const match = matches[occurrence];
  if (match === undefined) throw new Error(`Button not found: ${label}`);
  return match;
}

function click(element: ReactElement): void {
  const props = element.props as { readonly onClick?: () => void };
  props.onClick?.();
}

function view(
  overrides: Partial<Parameters<typeof WorkspaceNavigationContent>[0]> = {},
): ReactNode {
  return WorkspaceNavigationContent({
    closeDisabledReason: null,
    confirmationOpen: false,
    onRequestClose: () => undefined,
    onCancelClose: () => undefined,
    onConfirmClose: () => undefined,
    navigationRef: createRef<HTMLFieldSetElement>(),
    closeButtonRef: createRef<HTMLButtonElement>(),
    dialogRef: createRef<HTMLElement>(),
    cancelButtonRef: createRef<HTMLButtonElement>(),
    onDialogKeyDown: () => undefined,
    ...overrides,
  });
}

describe("desktop workspace navigation", () => {
  it("blocks pending work and asks the user to stop a running review", () => {
    expect(workspaceCloseDisabledReason({ ...available, profilePending: true })).toBe(
      pendingMessage,
    );
    expect(workspaceCloseDisabledReason({ ...available, knowledgePending: true })).toBe(
      pendingMessage,
    );
    expect(workspaceCloseDisabledReason({ ...available, busy: true })).toBe(pendingMessage);
    expect(workspaceCloseDisabledReason({ ...available, pendingReviewAction: true })).toBe(
      pendingMessage,
    );
    expect(workspaceCloseDisabledReason({ ...available, running: true })).toBe(
      "Stop the review before closing the workspace.",
    );
    expect(workspaceCloseDisabledReason(available)).toBeNull();
  });

  it("runs the close callback only after rechecking the current guard", () => {
    const onClose = vi.fn();

    expect(runWorkspaceCloseIfAllowed({ ...available, profilePending: true }, onClose)).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
    expect(runWorkspaceCloseIfAllowed(available, onClose)).toBe(true);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps a review from starting while candidate-profile work is pending", () => {
    expect(candidateProfileStartDisabledReason(true, null, false, true)).toBe(
      candidateProfilePendingBlockerMessage,
    );
  });

  it("wires confirmation, cancel, and close actions to their current handlers", () => {
    const onRequestClose = vi.fn();
    const onCancelClose = vi.fn();
    const onConfirmClose = vi.fn();
    const closed = view({
      onRequestClose,
      onCancelClose,
      onConfirmClose,
    });
    click(button(closed, "Close workspace"));
    expect(onRequestClose).toHaveBeenCalledOnce();

    const confirming = view({
      confirmationOpen: true,
      onRequestClose,
      onCancelClose,
      onConfirmClose,
    });
    click(button(confirming, "Cancel"));
    click(button(confirming, "Close workspace", 1));
    expect(onCancelClose).toHaveBeenCalledOnce();
    expect(onConfirmClose).toHaveBeenCalledOnce();
  });

  it("keeps an already-open confirmation from closing during newly pending work", () => {
    const onConfirmClose = vi.fn();
    const confirming = view({
      closeDisabledReason: pendingMessage,
      confirmationOpen: true,
      onConfirmClose,
    });
    const closeButton = button(confirming, "Close workspace", 1);
    expect((closeButton.props as { readonly disabled?: boolean }).disabled).toBe(true);
    click(closeButton);
    expect(onConfirmClose).not.toHaveBeenCalled();
  });

  it("stops confirmation keystrokes from reaching workspace shortcuts", () => {
    const stopPropagation = vi.fn();

    suppressWorkspaceDialogShortcut({ stopPropagation });

    expect(stopPropagation).toHaveBeenCalledOnce();
  });

  it("explains local saved history and discarded form edits in an accessible dialog", () => {
    const html = renderToStaticMarkup(view({ confirmationOpen: true }));

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="workspace-close-title"');
    expect(html).toContain(
      "Saved workspace files, run history, and profile versions stay on this device.",
    );
    expect(html).toContain("unsaved setup or profile form edits will be discarded.");
    expect(html).toContain("Cancel");
  });
});
