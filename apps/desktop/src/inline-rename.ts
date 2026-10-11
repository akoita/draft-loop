import { type KeyboardEvent, useEffect, useRef, useState } from "react";

export interface InlineRenameOptions {
  /** The name shown while not editing. */
  readonly name: string;
  /** The trimmed name when it is valid; `undefined` otherwise. */
  readonly normalize: (value: string) => string | undefined;
  readonly invalidMessage: string;
  /** Shown when `onRename` rejects without a message of its own. */
  readonly failureMessage: string;
  /** Resolves once the name is stored; omit when the host cannot rename. */
  readonly onRename?: ((name: string) => Promise<void>) | undefined;
  /** The field that takes focus when editing starts. */
  readonly inputId: string;
  /** The control focus returns to after Enter or Escape. */
  readonly buttonId: string;
}

export interface InlineRename {
  readonly editing: boolean;
  readonly draft: string;
  readonly busy: boolean;
  readonly errorMessage: string | null;
  /** Opens the field with the current name, or with a suggested one. */
  readonly start: (initialDraft?: string) => void;
  readonly change: (value: string) => void;
  /** Enter: save, keeping the field open with an alert when the name is invalid. */
  readonly save: () => void;
  /** Focus left the field: save a valid change, otherwise quietly keep the old name. */
  readonly commit: () => void;
  readonly cancel: () => void;
  /** Enter saves and Escape cancels, for the field's `onKeyDown`. */
  readonly onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
}

/**
 * In-place renaming shared by the workspace heading and application names: the name becomes a
 * field, Enter or leaving the field saves, and Escape cancels.
 */
export function useInlineRename({
  name,
  normalize,
  invalidMessage,
  failureMessage,
  onRename,
  inputId,
  buttonId,
}: InlineRenameOptions): InlineRename {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Refs, because the field's blur can fire after Enter or Escape already ended editing.
  const editingRef = useRef(false);
  const busyRef = useRef(false);
  const restoreFocus = useRef(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the ids are fixed per field.
  useEffect(() => {
    if (editing) {
      const input = document.getElementById(inputId) as HTMLInputElement | null;
      input?.focus();
      input?.select();
    } else if (restoreFocus.current) {
      document.getElementById(buttonId)?.focus();
    }
    restoreFocus.current = false;
  }, [editing]);

  const finish = (returnFocus: boolean) => {
    editingRef.current = false;
    restoreFocus.current = returnFocus;
    setEditing(false);
    setErrorMessage(null);
  };

  const store = async (fromKeyboard: boolean) => {
    if (!editingRef.current || busyRef.current) return;
    const valid = normalize(draft);
    if (valid === undefined) {
      if (fromKeyboard) setErrorMessage(invalidMessage);
      else finish(false);
      return;
    }
    if (valid === name || onRename === undefined) {
      finish(fromKeyboard);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setErrorMessage(null);
    try {
      await onRename(valid);
      finish(fromKeyboard);
    } catch (reason: unknown) {
      setErrorMessage(
        reason instanceof Error && reason.message.trim() !== "" ? reason.message : failureMessage,
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const cancel = () => {
    if (editingRef.current) finish(true);
  };

  return {
    editing,
    draft,
    busy,
    errorMessage,
    start: (initialDraft = name) => {
      setDraft(initialDraft);
      setErrorMessage(null);
      editingRef.current = true;
      setEditing(true);
    },
    change: (value) => {
      setDraft(value);
      setErrorMessage(null);
    },
    save: () => void store(true),
    commit: () => void store(false),
    cancel,
    onKeyDown: (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        if (!busyRef.current) void store(true);
        return;
      }
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (!busyRef.current) cancel();
    },
  };
}
