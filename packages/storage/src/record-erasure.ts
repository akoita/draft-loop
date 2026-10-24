/**
 * Erasing a whole candidate record (ADR 0011, D7): its history, settings, assignments, consent
 * ledger, audit chain and the knowledge bases it owns. A candidate record is a workspace in the
 * organisation's tenant, named by the id the API uses for it.
 *
 * Erasure runs in two steps so stored objects go before the rows that name them. `close` marks the
 * record as erasing, after which every caller treats it as missing, and returns the object keys to
 * delete. `erase` then removes every row in one transaction, the mark last. A repeated `close`
 * finds the mark and returns the same keys, so an interrupted erasure finishes on the next call.
 * The port acts within one tenant, which storage sets before every statement.
 */

/** What closing a record found. */
export type RecordClosure =
  /** No such record in the tenant, or it was erased already. */
  | { readonly state: "missing" }
  /** A run is queued or running; the caller stops it before erasing. Nothing was marked. */
  | { readonly state: "run-active" }
  /**
   * The record is closed. `resumed` is true when an earlier call had closed it already.
   * `objectKeys` are the blob storage keys the record's rows name, to delete before `erase`.
   */
  | {
      readonly state: "closed";
      readonly resumed: boolean;
      readonly objectKeys: readonly string[];
    };

/** What `erase` removed: counts only, never content. */
export interface RecordErasureResult {
  /** Rows removed across every table, the record's closing mark included. */
  readonly rowsRemoved: number;
  /** The object keys the erased rows named; `close` returned the same ones. */
  readonly objectKeys: readonly string[];
}

export interface CandidateRecordErasure {
  /** Marks the record as erasing, unless a run is active, and returns the objects to delete. */
  close(workspaceId: string): Promise<RecordClosure>;
  /** Whether the record is marked as erasing: every reader treats it as missing. */
  isClosed(workspaceId: string): Promise<boolean>;
  /** Removes every row of a closed record in one transaction; refuses a record not closed. */
  erase(workspaceId: string): Promise<RecordErasureResult>;
}

export type RecordErasureErrorCode =
  /** The workspace id does not satisfy the port's rules. */
  | "invalid_input"
  /** `erase` was called before `close` marked the record. */
  | "not_closed";

/** Why the port refused. Its message is safe to show. */
export class RecordErasureError extends Error {
  readonly code: RecordErasureErrorCode;

  constructor(code: RecordErasureErrorCode, message: string) {
    super(message);
    this.name = "RecordErasureError";
    this.code = code;
  }
}

const maximumWorkspaceIdLength = 256;

export function requireErasedRecordId(workspaceId: string): string {
  if (
    workspaceId.length === 0 ||
    workspaceId.length > maximumWorkspaceIdLength ||
    workspaceId.trim() !== workspaceId
  ) {
    throw new RecordErasureError("invalid_input", "Invalid candidate record id.");
  }
  return workspaceId;
}

/**
 * Removes stored objects outright for an erasure, whatever they hold. Unlike the blob port's
 * checked delete, an object replaced since its reference was written is removed too.
 */
export interface BlobErasure {
  /** Removes the object at the key; false when there was none. Refuses another tenant's key. */
  removeObject(key: string): Promise<boolean>;
  /**
   * Removes every object whose key starts with the prefix, which must end in `/` and sit under the
   * tenant's own prefix; resolves with how many it removed.
   */
  removePrefix(keyPrefix: string): Promise<number>;
}

/** What closing an organisation found. */
export type OrganisationClosure =
  /** No such organisation in the directory, or it was erased already. */
  | { readonly state: "missing" }
  /** A run is queued or executing somewhere in the tenant; the caller stops it first. Nothing was marked. */
  | { readonly state: "run-active" }
  /** The organisation is closing. `resumed` is true when an earlier call had marked it already. */
  | { readonly state: "closing"; readonly resumed: boolean };

/**
 * Erasing a whole organisation: `close` marks the organisation as closing, after which the API
 * refuses every member request, so nothing is created while the caller erases each record with
 * `CandidateRecordErasure`, then every object under the tenant's prefix, then what the tenant
 * still has with `eraseRemainder`. The directory rows go last, so an interrupted erasure can be
 * called again: a repeated `close` finds the mark and the caller resumes.
 */
export interface OrganisationErasure {
  /** Marks the organisation as closing, unless a run is active. The mark is never lifted. */
  close(): Promise<OrganisationClosure>;
  /** Whether the tenant's organisation is marked as closing; false when it is not in the directory. */
  isClosing(): Promise<boolean>;
  /** Every candidate record of the tenant, closed ones included, by id in ascending order. */
  listRecords(): Promise<readonly string[]>;
  /** Removes every row the tenant still has, the organisation and its members last. */
  eraseRemainder(): Promise<{ readonly rowsRemoved: number }>;
}
