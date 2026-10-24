/**
 * A candidate record's consent ledger (ADR 0011, D7): who granted or withdrew which consent, on
 * what basis and when. A candidate record is a workspace, addressed by its record id. The ledger
 * is append-only: an entry is never changed or removed, and a withdrawal is a new entry. This
 * module holds only the port, its records, its input rules and its errors; storage implements it.
 */

/**
 * What a consent covers.
 * - `material-storage`: a member attests a lawful basis to store the candidate's material.
 * - `provider-transmission`: the candidate agrees that bounded, approved excerpts may be sent to
 *   the named model providers.
 */
export type ConsentKind = "material-storage" | "provider-transmission";

export const consentKinds: readonly ConsentKind[] = ["material-storage", "provider-transmission"];

export type ConsentAction = "granted" | "withdrawn";

export const consentActions: readonly ConsentAction[] = ["granted", "withdrawn"];

/** The lawful basis an entry records. */
export type ConsentBasis = "candidate-consent" | "contract" | "legitimate-interest";

/** The bases each kind accepts: sending material to a provider needs the candidate's consent. */
export const consentBases: Readonly<Record<ConsentKind, readonly ConsentBasis[]>> = {
  "material-storage": ["candidate-consent", "contract", "legitimate-interest"],
  "provider-transmission": ["candidate-consent"],
};

/** Who recorded an entry: the deployment's owner token, or one organisation member. */
export type ConsentRecorder =
  | { readonly kind: "owner" }
  | { readonly kind: "member"; readonly memberId: string };

export interface ConsentEntryInput {
  readonly workspaceId: string;
  readonly kind: ConsentKind;
  readonly action: ConsentAction;
  readonly basis: ConsentBasis;
  readonly recordedBy: ConsentRecorder;
  /** The provider companies a `provider-transmission` grant names; empty for every other entry. */
  readonly providers?: readonly string[];
  /** A short, user-visible reason; never candidate material. */
  readonly note?: string;
}

export interface ConsentEntry {
  readonly id: string;
  readonly workspaceId: string;
  readonly kind: ConsentKind;
  readonly action: ConsentAction;
  readonly basis: ConsentBasis;
  readonly recordedBy: ConsentRecorder;
  readonly providers: readonly string[];
  readonly note?: string;
  readonly recordedAt: string;
}

/** Each kind's latest entry; a kind never recorded is absent. */
export type ConsentState = Readonly<Partial<Record<ConsentKind, ConsentEntry>>>;

export interface ConsentLedger {
  /** Appends a grant or a withdrawal and returns it with its id and time. */
  record(input: ConsentEntryInput): Promise<ConsentEntry>;
  /** The record's entries, oldest first. */
  history(workspaceId: string): Promise<readonly ConsentEntry[]>;
  /** The record's latest entry of each kind. */
  current(workspaceId: string): Promise<ConsentState>;
}

export type ConsentLedgerErrorCode =
  /** A workspace id, kind, action, basis, provider or note does not satisfy the ledger's rules. */
  "invalid_input";

/**
 * Why the ledger refused an entry. Its message is safe to show, and its code lets an adapter
 * choose the answer, such as 400.
 */
export class ConsentLedgerError extends Error {
  readonly code: ConsentLedgerErrorCode;

  constructor(code: ConsentLedgerErrorCode, message: string) {
    super(message);
    this.name = "ConsentLedgerError";
    this.code = code;
  }
}

export const maximumConsentNoteLength = 500;
const maximumWorkspaceIdLength = 256;
const maximumProviders = 8;
const providerPattern = /^[a-z][a-z0-9-]{0,63}$/u;
const memberIdPattern = /^[^\s]{1,128}$/u;

function invalid(message: string): ConsentLedgerError {
  return new ConsentLedgerError("invalid_input", message);
}

export function requireConsentWorkspaceId(workspaceId: string): string {
  if (
    workspaceId.length === 0 ||
    workspaceId.length > maximumWorkspaceIdLength ||
    workspaceId.trim() !== workspaceId
  ) {
    throw invalid("Invalid workspace id.");
  }
  return workspaceId;
}

function requireRecorder(recorder: ConsentRecorder): ConsentRecorder {
  if (recorder.kind === "owner") return { kind: "owner" };
  if (recorder.kind === "member" && memberIdPattern.test(recorder.memberId)) {
    return { kind: "member", memberId: recorder.memberId };
  }
  throw invalid("Invalid recording member.");
}

/** Sorted and without repeats, so equal grants store equal lists. */
function requireProviders(input: ConsentEntryInput): readonly string[] {
  const providers = [...new Set(input.providers ?? [])].sort();
  if (providers.length > maximumProviders || providers.some((p) => !providerPattern.test(p))) {
    throw invalid("Invalid provider.");
  }
  const namesProviders = input.kind === "provider-transmission" && input.action === "granted";
  if (namesProviders && providers.length === 0) {
    throw invalid("A provider transmission grant names at least one provider.");
  }
  if (!namesProviders && providers.length > 0) {
    throw invalid("Only a provider transmission grant names providers.");
  }
  return providers;
}

/** Checks an entry against the ledger's rules and returns it normalized: a blank note is dropped. */
export function requireConsentEntryInput(input: ConsentEntryInput): ConsentEntryInput {
  if (!consentKinds.includes(input.kind)) throw invalid("Invalid consent kind.");
  if (!consentActions.includes(input.action)) throw invalid("Invalid consent action.");
  if (!consentBases[input.kind].includes(input.basis)) {
    throw invalid("The basis does not apply to this consent kind.");
  }
  const note = input.note?.trim() ?? "";
  if (note.length > maximumConsentNoteLength) throw invalid("The note is too long.");
  return {
    workspaceId: requireConsentWorkspaceId(input.workspaceId),
    kind: input.kind,
    action: input.action,
    basis: input.basis,
    recordedBy: requireRecorder(input.recordedBy),
    providers: requireProviders(input),
    ...(note === "" ? {} : { note }),
  };
}

/** Each kind's latest entry in a history listed oldest first. */
export function currentConsents(history: readonly ConsentEntry[]): ConsentState {
  const state: Partial<Record<ConsentKind, ConsentEntry>> = {};
  for (const entry of history) state[entry.kind] = entry;
  return state;
}
