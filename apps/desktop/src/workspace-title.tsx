import {
  invalidWorkspaceNameMessage,
  normalizeWorkspaceDisplayName,
} from "@draft-loop/ui/workspace-name";
import type { KeyboardEvent } from "react";
import { useInlineRename } from "./inline-rename.js";

const nameInputId = "workspace-title-input";
const renameButtonId = "workspace-title-rename";
const errorId = "workspace-title-error";

interface WorkspaceTitleViewProps {
  readonly name: string;
  readonly editing: boolean;
  readonly draft: string;
  readonly busy: boolean;
  readonly errorMessage: string | null;
  readonly canRename: boolean;
  readonly onStartEditing: () => void;
  readonly onDraftChange: (value: string) => void;
  /** Enter: save, keeping the field open with an alert when the name is invalid. */
  readonly onSave: () => void;
  /** Focus left the field: save a valid change, otherwise quietly keep the old name. */
  readonly onCommit: () => void;
  readonly onCancel: () => void;
}

export function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M4.5 19.5h3.8L18.6 9.2a2.7 2.7 0 0 0-3.8-3.8L4.5 15.7v3.8Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="m13.5 6.7 3.8 3.8" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

/**
 * The workspace heading. When the host supports renaming, the name itself is
 * editable in place: double-click it, or use the pencil that appears on hover
 * and keyboard focus. Enter or leaving the field saves; Escape cancels.
 */
export function WorkspaceTitleView({
  name,
  editing,
  draft,
  busy,
  errorMessage,
  canRename,
  onStartEditing,
  onDraftChange,
  onSave,
  onCommit,
  onCancel,
}: WorkspaceTitleViewProps) {
  if (!editing) {
    if (!canRename) {
      return (
        <div className="workspace-title">
          <h1 title={name}>{name}</h1>
        </div>
      );
    }
    return (
      <div className="workspace-title workspace-title-editable">
        <h1 title={name} onDoubleClick={onStartEditing}>
          {name}
        </h1>
        <button
          id={renameButtonId}
          className="workspace-title-edit-button"
          type="button"
          aria-label={`Rename workspace ${name}`}
          title="Rename"
          onClick={onStartEditing}
        >
          <PencilIcon />
        </button>
      </div>
    );
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (!busy) onSave();
      return;
    }
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    if (!busy) onCancel();
  };

  return (
    <div className="workspace-title workspace-title-editing">
      <input
        id={nameInputId}
        className="workspace-title-input"
        type="text"
        value={draft}
        readOnly={busy}
        aria-busy={busy ? true : undefined}
        aria-label="Workspace name"
        aria-invalid={errorMessage === null ? undefined : true}
        aria-describedby={errorMessage === null ? undefined : errorId}
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => {
          if (!busy) onCommit();
        }}
      />
      {errorMessage === null ? null : (
        <p className="setup-blocker workspace-title-error" id={errorId} role="alert">
          {errorMessage}
        </p>
      )}
    </div>
  );
}

interface WorkspaceTitleProps {
  readonly name: string;
  /** Resolves with the stored name; omit when the host cannot rename. */
  readonly onRename?: (name: string) => Promise<void>;
}

export function WorkspaceTitle({ name, onRename }: WorkspaceTitleProps) {
  const rename = useInlineRename({
    name,
    normalize: normalizeWorkspaceDisplayName,
    invalidMessage: invalidWorkspaceNameMessage,
    failureMessage: "The workspace could not be renamed.",
    onRename,
    inputId: nameInputId,
    buttonId: renameButtonId,
  });
  return (
    <WorkspaceTitleView
      name={name}
      editing={rename.editing}
      draft={rename.draft}
      busy={rename.busy}
      errorMessage={rename.errorMessage}
      canRename={onRename !== undefined}
      onStartEditing={() => rename.start()}
      onDraftChange={rename.change}
      onSave={rename.save}
      onCommit={rename.commit}
      onCancel={rename.cancel}
    />
  );
}
