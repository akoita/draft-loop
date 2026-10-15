import type { AuditEvent } from "./index.js";

type JsonValue = AuditEvent["payload"];

/**
 * A run's snapshot is stored once, in `run_snapshots`. Its audit event records a reference to that
 * row rather than a second copy of the snapshot, which on a long run dominated the audit trail.
 * Events written before this shape carry the whole snapshot record; both are valid and both name
 * the snapshot row by `id`/`snapshotId` and its record checksum.
 */
export const runSnapshotAuditEventType = "run-snapshot.appended";
export const runSnapshotReferenceKind = "run-snapshot-reference.v1";

export interface RunSnapshotAuditReference {
  readonly kind: typeof runSnapshotReferenceKind;
  readonly snapshotId: string;
  readonly sequence: number;
  readonly runId: string;
  /** The snapshot row's `record_checksum`, which already covers its whole payload. */
  readonly checksum: string;
}

/** `sequence` is the snapshot row's autoincrement key, which SQLite returns as the insert rowid. */
export function runSnapshotRef(
  snapshotId: string,
  runId: string,
  sequence: number | bigint,
  checksum: string,
): JsonValue {
  const reference: RunSnapshotAuditReference = {
    kind: runSnapshotReferenceKind,
    snapshotId,
    sequence: Number(sequence),
    runId,
    checksum,
  };
  return { ...reference };
}

/** The snapshot row an event vouches for, whichever shape the event has; `undefined` if neither. */
export function runSnapshotTarget(
  payload: JsonValue,
): { readonly snapshotId: string; readonly checksum: string } | undefined {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return undefined;
  const fields = payload as { readonly [key: string]: JsonValue };
  const snapshotId = fields.kind === runSnapshotReferenceKind ? fields.snapshotId : fields.id;
  const checksum = fields.checksum;
  return typeof snapshotId === "string" && typeof checksum === "string"
    ? { snapshotId, checksum }
    : undefined;
}
