import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { invalidWorkspaceNameMessage, normalizeWorkspaceDisplayName } from "./workspace-name.js";

const nameInputId = "workspace-title-input";
const renameButtonId = "workspace-title-rename";

interface WorkspaceTitleViewProps {
  readonly name: string;
  readonly editing: boolean;
  readonly draft: string;
  readonly busy: boolean;
  readonly errorMessage: string | null;
  readonly canRename: boolean;
  readonly onStartEditing: () => void;
  readonly onDraftChange: (value: string) => void;
  readonly onSave: () => void;
  readonly onCancel: () => void;
}

/** The workspace heading, with an inline rename control when the host supports renaming. */
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
  onCancel,
}: WorkspaceTitleViewProps) {
  if (!editing) {
    return (
      <div className="workspace-title">
        <h1 title={name}>{name}</h1>
        {canRename ? (
          <button
            id={renameButtonId}
            className="button button-quiet workspace-title-action"
            type="button"
            aria-label={`Rename workspace ${name}`}
            onClick={onStartEditing}
          >
            Rename
          </button>
        ) : null}
      </div>
    );
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    onCancel();
  };

  return (
    <form
      className="workspace-title workspace-title-edit"
      aria-label="Rename workspace"
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy) onSave();
      }}
    >
      <input
        id={nameInputId}
        type="text"
        value={draft}
        disabled={busy}
        aria-label="Workspace name"
        aria-invalid={errorMessage === null ? undefined : true}
        aria-describedby={errorMessage === null ? undefined : "workspace-title-error"}
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <button className="button button-primary" type="submit" disabled={busy}>
        Save
      </button>
      <button className="button button-quiet" type="button" disabled={busy} onClick={onCancel}>
        Cancel
      </button>
      {errorMessage === null ? null : (
        <p className="setup-blocker workspace-title-error" id="workspace-title-error" role="alert">
          {errorMessage}
        </p>
      )}
    </form>
  );
}

interface WorkspaceTitleProps {
  readonly name: string;
  /** Resolves with the stored name; omit when the host cannot rename. */
  readonly onRename?: (name: string) => Promise<void>;
}

export function WorkspaceTitle({ name, onRename }: WorkspaceTitleProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const wasEditing = useRef(false);

  // Focus follows the mode: the field when editing starts, the Rename button when it ends.
  useEffect(() => {
    if (editing) document.getElementById(nameInputId)?.focus();
    else if (wasEditing.current) document.getElementById(renameButtonId)?.focus();
    if (editing) (document.getElementById(nameInputId) as HTMLInputElement | null)?.select();
    wasEditing.current = editing;
  }, [editing]);

  const save = async () => {
    const valid = normalizeWorkspaceDisplayName(draft);
    if (valid === undefined) {
      setErrorMessage(invalidWorkspaceNameMessage);
      return;
    }
    if (valid === name) {
      setEditing(false);
      setErrorMessage(null);
      return;
    }
    if (onRename === undefined) return;
    setBusy(true);
    setErrorMessage(null);
    try {
      await onRename(valid);
      setEditing(false);
    } catch (reason: unknown) {
      setErrorMessage(
        reason instanceof Error && reason.message.trim() !== ""
          ? reason.message
          : "The workspace could not be renamed.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <WorkspaceTitleView
      name={name}
      editing={editing}
      draft={draft}
      busy={busy}
      errorMessage={errorMessage}
      canRename={onRename !== undefined}
      onStartEditing={() => {
        setDraft(name);
        setErrorMessage(null);
        setEditing(true);
      }}
      onDraftChange={(value) => {
        setDraft(value);
        setErrorMessage(null);
      }}
      onSave={() => void save()}
      onCancel={() => {
        setEditing(false);
        setErrorMessage(null);
      }}
    />
  );
}
