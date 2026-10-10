export interface WorkspaceCreationDraft {
  readonly name: string;
  readonly maxRounds: number;
}

export interface WorkspaceCreationFormProps {
  readonly draft: WorkspaceCreationDraft;
  readonly busy: boolean;
  readonly errorMessage?: string | null;
  readonly onDraftChange: (draft: WorkspaceCreationDraft) => void;
  readonly onCreate?: (name: string, maxRounds: number) => void;
  readonly onCreateDemo?: () => void;
  readonly onOpen?: () => void;
  /**
   * False when the form sits in the secondary "Create a new workspace" section
   * and the page already offers Open and demo elsewhere.
   */
  readonly showAlternatives?: boolean;
}

export function workspaceCreationSubmission(name: string, maxRounds: number) {
  return { name: name.trim(), selection: { maxRounds } };
}

export function WorkspaceCreationForm({
  draft,
  busy,
  errorMessage = null,
  onDraftChange,
  onCreate,
  onCreateDemo,
  onOpen,
  showAlternatives = true,
}: WorkspaceCreationFormProps) {
  const validRounds =
    Number.isSafeInteger(draft.maxRounds) && draft.maxRounds >= 1 && draft.maxRounds <= 20;
  const canCreate = draft.name.trim() !== "" && validRounds;
  return (
    <form
      className="setup-form"
      aria-label={showAlternatives ? "Create or open a review workspace" : "Create a new workspace"}
      onSubmit={(event) => {
        event.preventDefault();
        if (busy || !canCreate || onCreate === undefined) return;
        onCreate(draft.name.trim(), draft.maxRounds);
      }}
    >
      <label className="setup-field">
        <span>Workspace name</span>
        <input
          type="text"
          value={draft.name}
          disabled={busy}
          aria-label="Workspace name"
          onChange={(event) => onDraftChange({ ...draft, name: event.target.value })}
        />
      </label>
      <label className="setup-field setup-round-limit">
        <span>Maximum review rounds</span>
        <input
          type="number"
          min={1}
          max={20}
          step={1}
          value={draft.maxRounds}
          disabled={busy}
          aria-label="Maximum review rounds"
          onChange={(event) =>
            onDraftChange({
              ...draft,
              maxRounds: event.target.value === "" ? 0 : Number(event.target.value),
            })
          }
        />
        <span className="setup-note">
          The author and critic stop after this many rounds and return the last fully reviewed draft
          to you. More rounds can improve convergence but use more time and provider budget.
        </span>
      </label>
      {errorMessage === null ? null : (
        <p className="setup-blocker" role="alert">
          {errorMessage}
        </p>
      )}
      <div className="approval-actions">
        <button
          className="button button-primary"
          type="submit"
          disabled={busy || !canCreate || onCreate === undefined}
        >
          Create workspace
        </button>
        {showAlternatives ? (
          <WorkspaceAlternatives busy={busy} onCreateDemo={onCreateDemo} onOpen={onOpen} />
        ) : null}
      </div>
    </form>
  );
}

/** The demo and folder-picker paths, shared by both start-page layouts. */
export function WorkspaceAlternatives({
  busy,
  onCreateDemo,
  onOpen,
}: {
  readonly busy: boolean;
  readonly onCreateDemo?: (() => void) | undefined;
  readonly onOpen?: (() => void) | undefined;
}) {
  return (
    <>
      <button
        className="button button-quiet"
        type="button"
        disabled={busy || onOpen === undefined}
        onClick={() => onOpen?.()}
      >
        Open workspace
      </button>
      <button
        className="button button-quiet"
        type="button"
        disabled={busy || onCreateDemo === undefined}
        onClick={() => onCreateDemo?.()}
      >
        Try demo workspace
      </button>
    </>
  );
}
