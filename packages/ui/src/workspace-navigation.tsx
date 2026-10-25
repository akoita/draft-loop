import type { KeyboardEvent, ReactNode, RefObject } from "react";
import { useEffect, useRef } from "react";
import { CloseWorkspaceIcon } from "./workspace-action-icons.js";

export interface WorkspaceCloseGuard {
  readonly busy: boolean;
  readonly knowledgePending: boolean;
  readonly pendingReviewAction: boolean;
  readonly profilePending: boolean;
  readonly running: boolean;
}

/** Explain the operation that currently prevents a workspace from closing. */
export function workspaceCloseDisabledReason(guard: WorkspaceCloseGuard): string | null {
  if (guard.busy || guard.knowledgePending || guard.pendingReviewAction || guard.profilePending) {
    return "Wait for the current workspace operation to finish before closing the workspace.";
  }
  if (guard.running) return "Stop the review before closing the workspace.";
  return null;
}

export function runWorkspaceCloseIfAllowed(
  guard: WorkspaceCloseGuard,
  onClose: () => void,
): boolean {
  if (workspaceCloseDisabledReason(guard) !== null) return false;
  onClose();
  return true;
}

export interface WorkspaceNavigationProps {
  readonly closeDisabledReason: string | null;
  readonly confirmationOpen: boolean;
  readonly onRequestClose: () => void;
  readonly onCancelClose: () => void;
  readonly onConfirmClose: () => void;
}

export function suppressWorkspaceDialogShortcut(event: {
  readonly stopPropagation: () => void;
}): void {
  event.stopPropagation();
}

export function WorkspaceNavigationContent({
  closeDisabledReason,
  confirmationOpen,
  onRequestClose,
  onCancelClose,
  onConfirmClose,
  navigationRef,
  closeButtonRef,
  dialogRef,
  cancelButtonRef,
  onDialogKeyDown,
}: WorkspaceNavigationProps & {
  readonly navigationRef: RefObject<HTMLFieldSetElement | null>;
  readonly closeButtonRef: RefObject<HTMLButtonElement | null>;
  readonly dialogRef: RefObject<HTMLElement | null>;
  readonly cancelButtonRef: RefObject<HTMLButtonElement | null>;
  readonly onDialogKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}): ReactNode {
  const closeDisabled = closeDisabledReason !== null;

  return (
    <fieldset ref={navigationRef} className="workspace-navigation" tabIndex={-1}>
      <legend className="sr-only">Workspace navigation</legend>
      <button
        ref={closeButtonRef}
        className="button button-toolbar"
        type="button"
        disabled={closeDisabled}
        {...(closeDisabledReason === null ? {} : { title: closeDisabledReason })}
        onClick={() => {
          if (!closeDisabled) onRequestClose();
        }}
      >
        <CloseWorkspaceIcon />
        Close workspace
      </button>
      {closeDisabledReason === null || confirmationOpen ? null : (
        <p className="workspace-navigation-guidance" role="status">
          {closeDisabledReason}
        </p>
      )}
      {confirmationOpen ? (
        <div className="modal-backdrop">
          <section
            ref={dialogRef}
            className="modal-card workspace-close-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="workspace-close-title"
            aria-describedby="workspace-close-copy"
            tabIndex={-1}
            onKeyDown={onDialogKeyDown}
          >
            <div className="modal-header">
              <div>
                <p className="eyebrow">Workspace navigation</p>
                <h2 id="workspace-close-title">Close this workspace?</h2>
              </div>
            </div>
            <p className="modal-copy" id="workspace-close-copy">
              Saved workspace files, run history, and profile versions stay on this device. Any
              unsaved setup or profile form edits will be discarded.
            </p>
            {closeDisabledReason === null ? null : (
              <p className="workspace-navigation-guidance" role="status">
                {closeDisabledReason}
              </p>
            )}
            <div className="workspace-close-actions">
              <button
                ref={cancelButtonRef}
                className="button button-outline"
                type="button"
                onClick={onCancelClose}
              >
                Cancel
              </button>
              <button
                className="button button-primary"
                type="button"
                disabled={closeDisabled}
                onClick={() => {
                  if (!closeDisabled) onConfirmClose();
                }}
              >
                Close workspace
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </fieldset>
  );
}

/** Workspace-level navigation shared by collecting and review headers. */
export function WorkspaceNavigation({
  closeDisabledReason,
  confirmationOpen,
  onRequestClose,
  onCancelClose,
  onConfirmClose,
}: WorkspaceNavigationProps): ReactNode {
  const navigationRef = useRef<HTMLFieldSetElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const confirmationWasOpen = useRef(false);

  useEffect(() => {
    if (confirmationOpen) {
      confirmationWasOpen.current = true;
      cancelButtonRef.current?.focus();
    } else if (confirmationWasOpen.current) {
      confirmationWasOpen.current = false;
      if (closeButtonRef.current?.disabled) navigationRef.current?.focus();
      else closeButtonRef.current?.focus();
    }
  }, [confirmationOpen]);

  const onDialogKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    suppressWorkspaceDialogShortcut(event);
    if (event.key === "Escape") {
      event.preventDefault();
      onCancelClose();
      return;
    }
    if (event.key !== "Tab") return;

    const dialog = dialogRef.current;
    if (dialog === null) return;
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    const first = focusable[0];
    const last = focusable.at(-1);
    if (first === undefined || last === undefined) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    if (
      event.shiftKey &&
      (document.activeElement === first || !dialog.contains(document.activeElement))
    ) {
      event.preventDefault();
      last.focus();
    } else if (
      !event.shiftKey &&
      (document.activeElement === last || !dialog.contains(document.activeElement))
    ) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <WorkspaceNavigationContent
      closeDisabledReason={closeDisabledReason}
      confirmationOpen={confirmationOpen}
      onRequestClose={onRequestClose}
      onCancelClose={onCancelClose}
      onConfirmClose={onConfirmClose}
      navigationRef={navigationRef}
      closeButtonRef={closeButtonRef}
      dialogRef={dialogRef}
      cancelButtonRef={cancelButtonRef}
      onDialogKeyDown={onDialogKeyDown}
    />
  );
}
