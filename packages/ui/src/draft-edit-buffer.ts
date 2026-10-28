import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import type { FooterBlocker } from "./review-footer.js";

/**
 * The candidate's typing in a draft block, held on screen until the host has saved it.
 *
 * Saving each keystroke made the web drop most of them: one save is a round trip, and the
 * screen takes no review action while another is pending (#1925). The buffer keeps what was
 * typed, saves one edit once the person pauses or leaves the block, and drops its copy when the
 * save completes, so the screen then shows what the host holds.
 */
export interface DraftEditEntry {
  readonly text: string;
  /** The person paused or left the block, so the text can be saved. */
  readonly ready: boolean;
}

export interface DraftEditBufferState {
  readonly entries: ReadonlyMap<string, DraftEditEntry>;
  /** The save sent last; `sawBusy` once the screen showed it pending. */
  readonly inFlight: {
    readonly blockId: string;
    readonly text: string;
    readonly sawBusy: boolean;
  } | null;
}

export type DraftEditEvent =
  | { readonly type: "change"; readonly blockId: string; readonly text: string }
  | { readonly type: "settle"; readonly blockId: string }
  | { readonly type: "sent"; readonly blockId: string; readonly text: string }
  | { readonly type: "busy"; readonly busy: boolean }
  | { readonly type: "lost" }
  | { readonly type: "saved"; readonly savedText: ReadonlyMap<string, string> };

export const emptyDraftEditBuffer: DraftEditBufferState = { entries: new Map(), inFlight: null };

/** How long typing pauses before the edit is saved. */
export const DRAFT_EDIT_IDLE_MS = 800;

/** How long a sent save may go unseen as pending before it counts as never started. */
export const DRAFT_EDIT_LOST_MS = 3_000;

export const SAVING_EDITS_NOTE = "Saving your edits…";

/** The footer's line while typed text is unsaved: approving now would leave it out. */
export const savingEditsBlocker: FooterBlocker = {
  kind: "waiting",
  text: SAVING_EDITS_NOTE,
  tone: "neutral",
};

function withEntries(
  state: DraftEditBufferState,
  update: (entries: Map<string, DraftEditEntry>) => void,
): DraftEditBufferState {
  const entries = new Map(state.entries);
  update(entries);
  return { ...state, entries };
}

export function draftEditReducer(
  state: DraftEditBufferState,
  event: DraftEditEvent,
): DraftEditBufferState {
  switch (event.type) {
    case "change":
      return withEntries(state, (entries) =>
        entries.set(event.blockId, { text: event.text, ready: false }),
      );
    case "settle": {
      const entry = state.entries.get(event.blockId);
      if (entry === undefined || entry.ready) return state;
      return withEntries(state, (entries) => entries.set(event.blockId, { ...entry, ready: true }));
    }
    case "sent":
      return { ...state, inFlight: { blockId: event.blockId, text: event.text, sawBusy: false } };
    case "busy": {
      const inFlight = state.inFlight;
      if (inFlight === null) return state;
      if (event.busy)
        return inFlight.sawBusy ? state : { ...state, inFlight: { ...inFlight, sawBusy: true } };
      if (!inFlight.sawBusy) return state;
      // The save finished, saved or refused: the screen shows the host's text from here on,
      // unless the person kept typing in that block meanwhile.
      const entry = state.entries.get(inFlight.blockId);
      const settled = withEntries(state, (entries) => {
        if (entry?.text === inFlight.text) entries.delete(inFlight.blockId);
      });
      return { ...settled, inFlight: null };
    }
    case "lost":
      return state.inFlight === null || state.inFlight.sawBusy
        ? state
        : { ...state, inFlight: null };
    case "saved": {
      let changed = false;
      const entries = new Map<string, DraftEditEntry>();
      for (const [blockId, entry] of state.entries) {
        const saved = event.savedText.get(blockId);
        // A block the draft no longer has, or one the host already holds as typed, needs no save.
        if (saved === undefined || (saved === entry.text && state.inFlight?.blockId !== blockId)) {
          changed = true;
        } else {
          entries.set(blockId, entry);
        }
      }
      return changed ? { ...state, entries } : state;
    }
  }
}

/** The next edit to save, or null while another action is pending or nothing is ready. */
export function nextDraftEditToSave(
  state: DraftEditBufferState,
  savedText: ReadonlyMap<string, string>,
  { busy, editable }: { readonly busy: boolean; readonly editable: boolean },
): { readonly blockId: string; readonly text: string } | null {
  if (busy || !editable || state.inFlight !== null) return null;
  for (const [blockId, entry] of state.entries) {
    if (entry.ready && savedText.has(blockId) && savedText.get(blockId) !== entry.text) {
      return { blockId, text: entry.text };
    }
  }
  return null;
}

/** Whether typed text is still waiting for, or in the middle of, a save. */
export function hasUnsavedDraftEdits(
  state: DraftEditBufferState,
  savedText: ReadonlyMap<string, string>,
): boolean {
  if (state.inFlight !== null) return true;
  for (const [blockId, entry] of state.entries) {
    if (savedText.has(blockId) && savedText.get(blockId) !== entry.text) return true;
  }
  return false;
}

export interface DraftEditBuffer {
  /** What the block shows: the typed text while it is unsaved, else the saved text. */
  readonly text: (blockId: string, saved: string) => string;
  readonly change: (blockId: string, text: string) => void;
  /** The person left the block: save what they typed without waiting for the pause. */
  readonly settle: (blockId: string) => void;
  readonly unsaved: boolean;
}

export function useDraftEditBuffer({
  savedText,
  editable,
  busy,
  save,
}: {
  readonly savedText: ReadonlyMap<string, string>;
  readonly editable: boolean;
  readonly busy: boolean;
  readonly save: (blockId: string, text: string) => void;
}): DraftEditBuffer {
  const [state, dispatch] = useReducer(draftEditReducer, emptyDraftEditBuffer);
  const idleTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const timers = idleTimers.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);
  useEffect(() => dispatch({ type: "busy", busy }), [busy]);
  useEffect(() => dispatch({ type: "saved", savedText }), [savedText]);
  useEffect(() => {
    const next = nextDraftEditToSave(state, savedText, { busy, editable });
    if (next === null) return;
    dispatch({ type: "sent", ...next });
    save(next.blockId, next.text);
  }, [state, savedText, busy, editable, save]);
  const inFlight = state.inFlight;
  useEffect(() => {
    if (inFlight === null || inFlight.sawBusy) return;
    const timer = setTimeout(() => dispatch({ type: "lost" }), DRAFT_EDIT_LOST_MS);
    return () => clearTimeout(timer);
  }, [inFlight]);

  const settle = useCallback((blockId: string) => {
    const timer = idleTimers.current.get(blockId);
    if (timer !== undefined) clearTimeout(timer);
    idleTimers.current.delete(blockId);
    dispatch({ type: "settle", blockId });
  }, []);
  const change = useCallback(
    (blockId: string, text: string) => {
      dispatch({ type: "change", blockId, text });
      const timer = idleTimers.current.get(blockId);
      if (timer !== undefined) clearTimeout(timer);
      idleTimers.current.set(
        blockId,
        setTimeout(() => settle(blockId), DRAFT_EDIT_IDLE_MS),
      );
    },
    [settle],
  );
  const entries = state.entries;
  const text = useCallback(
    (blockId: string, saved: string) => entries.get(blockId)?.text ?? saved,
    [entries],
  );
  const unsaved = useMemo(() => hasUnsavedDraftEdits(state, savedText), [state, savedText]);
  return { text, change, settle, unsaved };
}
