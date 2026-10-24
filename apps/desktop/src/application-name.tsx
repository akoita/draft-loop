import { normalizeApplicationDisplayName } from "@draft-loop/ui/application-contract";
import { useEffect, useRef, useState } from "react";
import {
  applicationRenameFailureMessage,
  invalidApplicationNameMessage,
} from "./application-name-model.js";
import { WorkspaceLocation } from "./home.js";
import { useInlineRename } from "./inline-rename.js";
import { PencilIcon } from "./workspace-title.js";

const titleInputId = "application-title-input";
const titleRenameButtonId = "application-title-rename";
const titleErrorId = "application-title-error";

interface ApplicationTitleProps {
  readonly name: string;
  /** Resolves once the name is stored; omit when the host cannot rename. */
  readonly onRename?: ((name: string) => Promise<void>) | undefined;
  /** Bumped to open the field from elsewhere, such as the naming nudge. */
  readonly editRequest?: number;
}

/**
 * The application's page heading. Like the workspace heading, it is renamed in place: double-click
 * it, or use the pencil that appears on hover and keyboard focus. Enter or leaving the field saves;
 * Escape cancels.
 */
export function ApplicationTitle({ name, onRename, editRequest = 0 }: ApplicationTitleProps) {
  const rename = useInlineRename({
    name,
    normalize: normalizeApplicationDisplayName,
    invalidMessage: invalidApplicationNameMessage,
    failureMessage: applicationRenameFailureMessage,
    onRename,
    inputId: titleInputId,
    buttonId: titleRenameButtonId,
  });
  const handledRequest = useRef(editRequest);
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a new request opens the field.
  useEffect(() => {
    if (editRequest === handledRequest.current) return;
    handledRequest.current = editRequest;
    if (onRename !== undefined) rename.start();
  }, [editRequest]);

  if (rename.editing) {
    return (
      <div className="workspace-title workspace-title-editing">
        <input
          id={titleInputId}
          className="workspace-title-input"
          type="text"
          value={rename.draft}
          readOnly={rename.busy}
          aria-busy={rename.busy ? true : undefined}
          aria-label="Application name"
          aria-invalid={rename.errorMessage === null ? undefined : true}
          aria-describedby={rename.errorMessage === null ? undefined : titleErrorId}
          onChange={(event) => rename.change(event.target.value)}
          onKeyDown={rename.onKeyDown}
          onBlur={() => {
            if (!rename.busy) rename.commit();
          }}
        />
        {rename.errorMessage === null ? null : (
          <p className="setup-blocker workspace-title-error" id={titleErrorId} role="alert">
            {rename.errorMessage}
          </p>
        )}
      </div>
    );
  }
  if (onRename === undefined) return <WorkspaceLocation current={name} asHeading />;
  return (
    <div className="workspace-title workspace-title-editable">
      <WorkspaceLocation current={name} asHeading onHeadingDoubleClick={() => rename.start()} />
      <button
        id={titleRenameButtonId}
        className="workspace-title-edit-button"
        type="button"
        aria-label={`Rename application ${name}`}
        title="Rename"
        onClick={() => rename.start()}
      >
        <PencilIcon />
      </button>
    </div>
  );
}

interface ApplicationNameNudgeProps {
  readonly name: string;
  /** A name from the brief's role and employer, offered as one click. */
  readonly suggestedName: string | null;
  /** Stores a name; storing the current one keeps it and ends the nudge. */
  readonly onRename: (name: string) => Promise<void>;
  /** Opens the page heading for a name of the person's own. */
  readonly onChooseName: () => void;
}

/**
 * Asks once for a name in the person's own terms while the default application still has the
 * name DraftLoop derived from the workspace's job. Any choice, keeping the name included, ends it.
 */
export function ApplicationNameNudge({
  name,
  suggestedName,
  onRename,
  onChooseName,
}: ApplicationNameNudgeProps) {
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const store = (value: string) => {
    setBusy(true);
    setErrorMessage(null);
    onRename(value)
      .catch((reason: unknown) => {
        setErrorMessage(
          reason instanceof Error && reason.message.trim() !== ""
            ? reason.message
            : applicationRenameFailureMessage,
        );
      })
      .finally(() => setBusy(false));
  };
  return (
    <section className="application-name-nudge" aria-labelledby="application-name-nudge-title">
      <div className="application-name-nudge-text">
        <h2 id="application-name-nudge-title">Name this application</h2>
        <p>
          A name such as the role and the company tells it apart on Home once you apply for other
          roles.
        </p>
      </div>
      <div className="application-name-nudge-actions">
        {suggestedName === null ? null : (
          <button
            className="button button-primary"
            type="button"
            disabled={busy}
            onClick={() => store(suggestedName)}
          >
            Use “{suggestedName}”
          </button>
        )}
        <button
          className={suggestedName === null ? "button button-primary" : "button button-outline"}
          type="button"
          disabled={busy}
          onClick={onChooseName}
        >
          {suggestedName === null ? "Choose a name" : "Choose another name"}
        </button>
        <button
          className="button button-quiet"
          type="button"
          disabled={busy}
          onClick={() => store(name)}
        >
          Keep “{name}”
        </button>
      </div>
      {errorMessage === null ? null : (
        <p className="setup-blocker application-name-nudge-error" role="alert">
          {errorMessage}
        </p>
      )}
    </section>
  );
}
