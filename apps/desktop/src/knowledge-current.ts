/**
 * Decisions for the Manage career evidence panel that follow the workspace's current knowledge
 * base, kept free of React so they can be tested without a DOM.
 */

export interface ShownKnowledgeSelection {
  readonly storeId: string;
  readonly ids: readonly string[];
}

function sameSelection(left: ShownKnowledgeSelection, right: ShownKnowledgeSelection): boolean {
  return (
    left.storeId === right.storeId &&
    left.ids.length === right.ids.length &&
    left.ids.every((id) => right.ids.includes(id))
  );
}

/**
 * Whether a reloaded current store should replace what the panel shows.
 *
 * The reload follows a knowledge change made elsewhere, usually the Career evidence card creating
 * or selecting a base. It applies when the person has not used the panel yet, or when the
 * workspace's selection now differs from the one shown. A reload that reports the selection the
 * panel already shows is dropped, so it cannot swap away a store the person opened to work in.
 */
export function shouldApplyReloadedKnowledge(input: {
  readonly userTouched: boolean;
  readonly shown: ShownKnowledgeSelection | null;
  readonly loaded: ShownKnowledgeSelection;
}): boolean {
  if (!input.userTouched || input.shown === null) return true;
  return !sameSelection(input.shown, input.loaded);
}

/** Whether a reload response may still be applied, given what happened since it started. */
export function reloadStillValid(input: {
  readonly startedSequence: number;
  readonly currentSequence: number;
  readonly operationInFlight: boolean;
}): boolean {
  return input.startedSequence === input.currentSequence && !input.operationInFlight;
}

/**
 * Whether a store-form request counter moved past the last one handled. Card 02's "Create or
 * choose a knowledge base" bumps the counter; the panel then opens its form and focuses the name.
 */
export function isNewStoreFormRequest(handled: number, requested: number): boolean {
  return requested !== handled;
}

export const differentStoreDisclosureLabel = "Use a different knowledge store…";

export const autoCreateHint =
  "Add career evidence from the Career evidence card above to create your knowledge base.";

/**
 * How the create-or-open form is offered.
 *
 * - `form`: shown directly, because the host cannot create a base itself and none exists yet.
 * - `open` / `collapsed`: behind the disclosure; open only when a saved store could not be opened.
 */
export function knowledgeStoreFormPresentation(input: {
  readonly hasStore: boolean;
  readonly autoCreateSupported: boolean;
  readonly savedUnavailable: boolean;
}): "form" | "open" | "collapsed" {
  if (!input.hasStore && !input.autoCreateSupported) return "form";
  return !input.hasStore && input.savedUnavailable ? "open" : "collapsed";
}
