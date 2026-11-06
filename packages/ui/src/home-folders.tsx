/**
 * Folder controls on Home (#2283): New folder and the By folder or All together switch above the
 * list, a foldable header per section with rename and delete, and Move to in an application's
 * actions menu. Home draws none of it when the host has no folders.
 */

import { applicationFolderNameMaxLength } from "@draft-loop/domain/application-folder";
import { type FormEvent, useState } from "react";
import type { ApplicationSummaryView } from "./application-contract.js";
import type { ApplicationFolderView } from "./application-folder-contract.js";
import {
  type FolderGrouping,
  type FolderSection,
  folderDeleteConfirmation,
  folderErrorMessage,
  folderGroupings,
  noFolderLabel,
} from "./home-folder-model.js";

/** What Home can do with folders; absent when the host has none. */
export interface HomeFolderActions {
  readonly folders: readonly ApplicationFolderView[];
  /** Each rejects with the message to show beside the field. */
  readonly onCreate: (name: string) => Promise<void>;
  readonly onRename: (folder: ApplicationFolderView, name: string) => Promise<void>;
  readonly onDelete: (folder: ApplicationFolderView) => Promise<void>;
  readonly onMove: (application: ApplicationSummaryView, folderId: string | null) => void;
}

const groupingLabels: Readonly<Record<FolderGrouping, string>> = {
  folders: "By folder",
  together: "All together",
};

/** A name field that submits on Enter and cancels on Escape, with its error under it. */
function FolderNameForm({
  id,
  label,
  initial,
  submitLabel,
  failure,
  onSubmit,
  onCancel,
}: {
  readonly id: string;
  readonly label: string;
  readonly initial: string;
  readonly submitLabel: string;
  readonly failure: string;
  readonly onSubmit: (name: string) => Promise<void>;
  readonly onCancel: () => void;
}) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorId = `${id}-error`;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === "") {
      setError("Give the folder a name.");
      return;
    }
    setBusy(true);
    setError(null);
    onSubmit(trimmed).then(
      () => setBusy(false),
      (reason: unknown) => {
        setBusy(false);
        setError(folderErrorMessage(reason, failure));
      },
    );
  };
  return (
    <form className="application-folder-form" onSubmit={submit}>
      <input
        id={id}
        type="text"
        value={name}
        maxLength={applicationFolderNameMaxLength}
        readOnly={busy}
        aria-label={label}
        aria-invalid={error === null ? undefined : true}
        aria-describedby={error === null ? undefined : errorId}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
        }}
      />
      <button className="button button-primary" type="submit" disabled={busy}>
        {submitLabel}
      </button>
      <button className="button button-outline" type="button" disabled={busy} onClick={onCancel}>
        Cancel
      </button>
      {error === null ? null : (
        <p className="setup-blocker" id={errorId} role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

export function FolderBar({
  grouping,
  hasFolders,
  disabled,
  initialCreating = false,
  onGrouping,
  onCreate,
}: {
  readonly grouping: FolderGrouping;
  readonly hasFolders: boolean;
  readonly disabled: boolean;
  /** Opens the New folder field on first render; for tests and previews. */
  readonly initialCreating?: boolean;
  readonly onGrouping: (grouping: FolderGrouping) => void;
  readonly onCreate: (name: string) => Promise<void>;
}) {
  const [creating, setCreating] = useState(initialCreating);
  return (
    <div className="application-folder-bar">
      {creating ? (
        <FolderNameForm
          id="application-folder-new"
          label="New folder name"
          initial=""
          submitLabel="Create folder"
          failure="The folder could not be created. Try again."
          onSubmit={async (name) => {
            await onCreate(name);
            setCreating(false);
          }}
          onCancel={() => setCreating(false)}
        />
      ) : (
        <button
          className="button button-outline"
          type="button"
          disabled={disabled}
          onClick={() => setCreating(true)}
        >
          New folder
        </button>
      )}
      {hasFolders ? (
        <fieldset className="applications-segmented">
          <legend className="sr-only">Group applications</legend>
          {folderGroupings.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={grouping === option}
              onClick={() => onGrouping(option)}
            >
              {groupingLabels[option]}
            </button>
          ))}
        </fieldset>
      ) : null}
    </div>
  );
}

export function FolderSectionHead({
  section,
  folded,
  bodyId,
  disabled,
  onToggle,
  onRename,
  onDelete,
}: {
  readonly section: FolderSection;
  readonly folded: boolean;
  readonly bodyId: string;
  readonly disabled: boolean;
  readonly onToggle: () => void;
  readonly onRename: (folder: ApplicationFolderView, name: string) => Promise<void>;
  readonly onDelete: (folder: ApplicationFolderView) => Promise<void>;
}) {
  const [mode, setMode] = useState<"idle" | "renaming" | "deleting">("idle");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { folder } = section;
  const name = folder?.name ?? noFolderLabel;
  if (folder !== null && mode === "renaming") {
    return (
      <div className="application-folder-head">
        <FolderNameForm
          id={`application-folder-rename-${folder.id}`}
          label={`New name for ${folder.name}`}
          initial={folder.name}
          submitLabel="Rename"
          failure="The folder could not be renamed. Try again."
          onSubmit={async (next) => {
            await onRename(folder, next);
            setMode("idle");
          }}
          onCancel={() => setMode("idle")}
        />
      </div>
    );
  }
  return (
    <div className="application-folder-head">
      <h3>
        <button
          className="application-folder-toggle"
          type="button"
          aria-expanded={!folded}
          aria-controls={bodyId}
          onClick={onToggle}
        >
          <span aria-hidden="true">{folded ? "▸" : "▾"}</span> {name}
          <span className="numeric">{section.applications.length}</span>
        </button>
      </h3>
      {folder === null ? null : mode === "deleting" ? (
        <fieldset className="application-card-confirm">
          <legend>{folderDeleteConfirmation(folder)}</legend>
          <div className="application-card-actions">
            <button
              className="button button-danger"
              type="button"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setDeleteError(null);
                onDelete(folder).then(
                  () => setBusy(false),
                  (reason: unknown) => {
                    setBusy(false);
                    setDeleteError(
                      folderErrorMessage(reason, "The folder could not be deleted. Try again."),
                    );
                  },
                );
              }}
            >
              Delete folder
            </button>
            <button
              className="button button-outline"
              type="button"
              disabled={busy}
              onClick={() => setMode("idle")}
            >
              Cancel
            </button>
          </div>
          {deleteError === null ? null : (
            <p className="setup-blocker" role="alert">
              {deleteError}
            </p>
          )}
        </fieldset>
      ) : (
        <div className="application-folder-actions">
          <button
            className="button button-outline button-small"
            type="button"
            disabled={disabled}
            aria-label={`Rename folder ${folder.name}`}
            onClick={() => setMode("renaming")}
          >
            Rename
          </button>
          <button
            className="button button-outline button-small"
            type="button"
            disabled={disabled}
            aria-label={`Delete folder ${folder.name}`}
            onClick={() => setMode("deleting")}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

/** Move to entries for an application's actions menu. */
export function MoveToItems({
  name,
  targets,
  busy,
}: {
  readonly name: string;
  readonly targets: readonly { readonly label: string; readonly onMove: () => void }[];
  readonly busy: boolean;
}) {
  return (
    <>
      {targets.map((target) => (
        <button
          key={target.label}
          type="button"
          disabled={busy}
          aria-label={`${target.label}: ${name}`}
          onClick={target.onMove}
        >
          {target.label}
        </button>
      ))}
    </>
  );
}
