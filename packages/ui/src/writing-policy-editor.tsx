import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { maximumWritingPolicyContentBytes, type WritingPolicyReadResult } from "./bridge.js";
import { useModalFocusTrap } from "./review.js";
import {
  type PolicySelectorDirective,
  readPolicySelectorValues,
  setPolicySelectorValue,
  writingPolicyPageTargets,
  writingPolicyTones,
  writingPolicyVerbosityLevels,
} from "./writing-policy-directives.js";

const policyTooLargeMessage = "The writing policy is too large; use at most 64 KiB.";

/** The size the application measures: the UTF-8 bytes of the text. */
export function writingPolicyByteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

export function writingPolicyOverLimit(text: string): boolean {
  return writingPolicyByteLength(text) > maximumWritingPolicyContentBytes;
}

function formatKibibytes(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

interface SelectorField {
  readonly directive: Exclude<PolicySelectorDirective, "spellingLocale">;
  readonly label: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
}

const selectorFields: readonly SelectorField[] = [
  {
    directive: "tone",
    label: "Tone",
    options: writingPolicyTones.map((value) => ({ value, label: capitalize(value) })),
  },
  {
    directive: "verbosity",
    label: "Verbosity",
    options: writingPolicyVerbosityLevels.map((value) => ({ value, label: capitalize(value) })),
  },
  {
    directive: "pageTarget",
    label: "Page target",
    options: writingPolicyPageTargets.map((value) => ({
      value,
      label: value === "one-page" ? "One page" : "Two pages",
    })),
  },
];

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

export interface WritingPolicyEditorViewProps {
  readonly load: "loading" | "failed" | "ready";
  /** Why loading failed, shown with a retry. */
  readonly loadMessage?: string | null;
  /** The whole policy text; the selectors are a view of it. */
  readonly text: string;
  /** True when the workspace has no saved policy and the text is the starting template. */
  readonly isDefaultTemplate: boolean;
  /** The saved version being edited, or null for the starting template. */
  readonly savedVersion: string | null;
  /** The application's message for the last rejected save, shown inline. */
  readonly saveError?: string | null;
  readonly saving: boolean;
  /** Text differs from what was loaded. */
  readonly dirty: boolean;
  /** The first close request with unsaved changes asks for a second one. */
  readonly discardArmed?: boolean;
  readonly onTextChange: (text: string) => void;
  readonly onSave: () => void;
  readonly onClose: () => void;
  readonly onRetry?: () => void;
  readonly dialogRef?: RefObject<HTMLDivElement | null>;
}

/** The writing policy editor dialog, driven entirely by its props. */
export function WritingPolicyEditorView({
  load,
  loadMessage = null,
  text,
  isDefaultTemplate,
  savedVersion,
  saveError = null,
  saving,
  dirty,
  discardArmed = false,
  onTextChange,
  onSave,
  onClose,
  onRetry,
  dialogRef,
}: WritingPolicyEditorViewProps) {
  const values = readPolicySelectorValues(text);
  const bytes = writingPolicyByteLength(text);
  const overLimit = bytes > maximumWritingPolicyContentBytes;
  const ready = load === "ready";
  const canSave = ready && !saving && !overLimit && (dirty || isDefaultTemplate);
  const setDirective = (directive: PolicySelectorDirective, value: string | null) =>
    onTextChange(setPolicySelectorValue(text, directive, value));
  return (
    <div className="modal-backdrop">
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="writing-policy-dialog-title"
        aria-describedby="writing-policy-dialog-copy"
        ref={dialogRef}
      >
        <div className="modal-header">
          <div>
            <p className="eyebrow">DraftLoop / Writing policy</p>
            <h2 id="writing-policy-dialog-title">Edit writing policy</h2>
          </div>
          <button className="button button-quiet" type="button" onClick={onClose}>
            {discardArmed ? "Discard changes" : "Close"}
            <kbd>Esc</kbd>
          </button>
        </div>
        <p className="modal-copy" id="writing-policy-dialog-copy">
          {isDefaultTemplate
            ? "This workspace has no writing policy yet. The text below is the starting template; saving creates the first version and applies it to future runs."
            : savedVersion === null
              ? "Saving creates a new version and applies it to future runs."
              : `Editing version ${savedVersion}. Saving creates a new version and applies it to future runs; earlier versions stay in the history.`}
        </p>
        {load === "loading" ? (
          <p className="setup-note" role="status">
            Loading the writing policy…
          </p>
        ) : null}
        {load === "failed" ? (
          <>
            <p className="setup-blocker" role="alert">
              {loadMessage ?? "The writing policy could not be loaded."}
            </p>
            <div className="approval-actions">
              <button
                className="button button-outline"
                type="button"
                disabled={onRetry === undefined}
                onClick={() => onRetry?.()}
              >
                Try again
              </button>
            </div>
          </>
        ) : null}
        {ready ? (
          <form
            className="setup-form policy-editor"
            aria-label="Edit writing policy"
            onSubmit={(event) => {
              event.preventDefault();
              if (canSave) onSave();
            }}
          >
            <div className="setup-sides">
              {selectorFields.map((field) => {
                const written = values[field.directive];
                const matched =
                  written === null
                    ? ""
                    : (field.options.find((option) => option.value === written.toLowerCase())
                        ?.value ?? written);
                const unrecognised =
                  matched !== "" && !field.options.some((o) => o.value === matched);
                return (
                  <label className="setup-field" key={field.directive}>
                    <span>{field.label}</span>
                    <select
                      value={matched}
                      disabled={saving}
                      onChange={(event) =>
                        setDirective(
                          field.directive,
                          event.target.value === "" ? null : event.target.value,
                        )
                      }
                    >
                      <option value="">Not set</option>
                      {unrecognised ? (
                        <option value={matched}>{`${matched} (not a valid choice)`}</option>
                      ) : null}
                      {field.options.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              })}
              <label className="setup-field">
                <span>Spelling locale</span>
                <input
                  type="text"
                  placeholder="en-GB"
                  value={values.spellingLocale ?? ""}
                  disabled={saving}
                  onChange={(event) =>
                    setDirective(
                      "spellingLocale",
                      event.target.value.trim() === "" ? null : event.target.value,
                    )
                  }
                />
              </label>
            </div>
            <label className="setup-field">
              <span>Policy text</span>
              <textarea
                className="policy-editor-text"
                spellCheck={false}
                value={text}
                disabled={saving}
                aria-label="Policy text"
                aria-describedby="writing-policy-text-note"
                onChange={(event) => onTextChange(event.target.value)}
              />
              <span className="setup-note" id="writing-policy-text-note">
                One <code>Name: value</code> line per directive, then free-text rules. The selectors
                above edit these lines; you can also edit them here. {formatKibibytes(bytes)} of{" "}
                {formatKibibytes(maximumWritingPolicyContentBytes)}.
              </span>
            </label>
            {overLimit ? (
              <p className="error-banner" role="alert">
                {policyTooLargeMessage}
              </p>
            ) : null}
            {saveError === null ? null : (
              <p className="error-banner" role="alert">
                {saveError}
              </p>
            )}
            {discardArmed ? (
              <p className="setup-note" role="status">
                You have unsaved changes. Choose Discard changes to close without saving.
              </p>
            ) : null}
            <div className="approval-actions">
              <button className="button button-primary" type="submit" disabled={!canSave}>
                {saving
                  ? "Saving…"
                  : isDefaultTemplate
                    ? "Save as first version"
                    : "Save new version"}
              </button>
              <button
                className="button button-quiet"
                type="button"
                disabled={saving}
                onClick={onClose}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : null}
      </div>
    </div>
  );
}

export interface WritingPolicyEditorProps {
  readonly workspaceId: string;
  readonly readPolicy: (workspaceId: string) => Promise<WritingPolicyReadResult>;
  /** Saves and activates the text; rejects with the application's message when it is invalid. */
  readonly savePolicy: (workspaceId: string, content: string) => Promise<void>;
  readonly onClose: () => void;
}

type LoadState =
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly message: string }
  | { readonly status: "ready"; readonly result: WritingPolicyReadResult };

/** Loads the current policy, tracks the edit, and saves it through the host. */
export function WritingPolicyEditor({
  workspaceId,
  readPolicy,
  savePolicy,
  onClose,
}: WritingPolicyEditorProps) {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [discardArmed, setDiscardArmed] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const mounted = useRef(true);
  // The read is a port method that may be a new function each render; a re-render must
  // never reload the policy over what the person has typed.
  const readPolicyRef = useRef(readPolicy);
  readPolicyRef.current = readPolicy;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // `loadAttempt` re-runs the read when the person retries.
  // biome-ignore lint/correctness/useExhaustiveDependencies: retry is the trigger, not a value read
  useEffect(() => {
    let cancelled = false;
    setLoadState({ status: "loading" });
    readPolicyRef.current(workspaceId).then(
      (result) => {
        if (cancelled) return;
        setText(result.content);
        setLoadState({ status: "ready", result });
      },
      (reason: unknown) => {
        if (cancelled) return;
        setLoadState({
          status: "failed",
          message:
            reason instanceof Error ? reason.message : "The writing policy could not be loaded.",
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [workspaceId, loadAttempt]);

  const loaded = loadState.status === "ready" ? loadState.result : null;
  const dirty = loaded !== null && text !== loaded.content;

  const requestClose = useCallback(() => {
    if (saving) return;
    if (dirty && !discardArmed) {
      setDiscardArmed(true);
      return;
    }
    onClose();
  }, [dirty, discardArmed, onClose, saving]);
  useModalFocusTrap(true, dialogRef, requestClose);

  const save = () => {
    if (saving || loaded === null) return;
    setSaving(true);
    setSaveError(null);
    savePolicy(workspaceId, text).then(
      () => {
        if (mounted.current) onClose();
      },
      (reason: unknown) => {
        if (!mounted.current) return;
        setSaving(false);
        setSaveError(
          reason instanceof Error ? reason.message : "The writing policy could not be saved.",
        );
      },
    );
  };

  return (
    <WritingPolicyEditorView
      load={loadState.status}
      loadMessage={loadState.status === "failed" ? loadState.message : null}
      text={text}
      isDefaultTemplate={loaded?.isDefaultTemplate ?? false}
      savedVersion={loaded?.version ?? null}
      saveError={saveError}
      saving={saving}
      dirty={dirty}
      discardArmed={discardArmed}
      onTextChange={(next) => {
        setText(next);
        setDiscardArmed(false);
        setSaveError(null);
      }}
      onSave={save}
      onClose={requestClose}
      onRetry={() => setLoadAttempt((attempt) => attempt + 1)}
      dialogRef={dialogRef}
    />
  );
}

export interface WritingPolicyEditActionProps extends Omit<WritingPolicyEditorProps, "onClose"> {
  readonly disabled?: boolean;
}

/** The "Edit policy" button for the Writing policy setup card, and the dialog it opens. */
export function WritingPolicyEditAction({
  disabled = false,
  ...editor
}: WritingPolicyEditActionProps) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button
        className="button button-outline"
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        Edit policy
      </button>
      {/* Portalled out of the setup card so no ancestor's layout can contain the fixed backdrop. */}
      {open && typeof document !== "undefined"
        ? createPortal(<WritingPolicyEditor {...editor} onClose={close} />, document.body)
        : null}
    </>
  );
}
