import type { AuditEvent } from "./ports/history.js";

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

function skipWhitespace(text: string, from: number): number {
  let index = from;
  while (index < text.length && " \n\r\t".includes(text.charAt(index))) index += 1;
  return index;
}

/** The index just past the string literal that starts at `start`, or -1 when it never closes. */
function stringEnd(text: string, start: number): number {
  let index = start + 1;
  for (;;) {
    const quote = text.indexOf('"', index);
    if (quote < 0) return -1;
    let backslashes = 0;
    while (quote - 1 - backslashes > start && text.charAt(quote - 1 - backslashes) === "\\") {
      backslashes += 1;
    }
    if (backslashes % 2 === 0) return quote + 1;
    index = quote + 1;
  }
}

/** The index just past the JSON value that starts at `start`, or -1 when the text is malformed. */
function valueEnd(text: string, start: number): number {
  const first = text.charAt(start);
  if (first === '"') return stringEnd(text, start);
  if (first !== "{" && first !== "[") {
    let index = start;
    while (index < text.length && !",}]".includes(text.charAt(index))) index += 1;
    return index === start ? -1 : index;
  }
  let depth = 0;
  for (let index = start; index < text.length; index += 1) {
    const character = text.charAt(index);
    if (character === '"') {
      const end = stringEnd(text, index);
      if (end < 0) return -1;
      index = end - 1;
    } else if (character === "{" || character === "[") {
      depth += 1;
    } else if (character === "}" || character === "]") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return -1;
}

/**
 * `runSnapshotTarget` for a stored payload text, without building the payload. A legacy event
 * carries the whole snapshot record, which can be tens of megabytes, and parsing it only to read
 * two top-level strings dominated memory. The scan skips every other value without allocating and
 * returns `undefined` for anything unexpected, in which case the caller parses as it always did.
 */
export function runSnapshotTargetFromText(
  text: string,
): { readonly snapshotId: string; readonly checksum: string } | undefined {
  const wanted = new Set(["kind", "snapshotId", "id", "checksum"]);
  const strings = new Map<string, string>();
  let index = skipWhitespace(text, 0);
  if (text.charAt(index) !== "{") return undefined;
  index = skipWhitespace(text, index + 1);
  while (text.charAt(index) !== "}") {
    if (text.charAt(index) !== '"') return undefined;
    const keyEnd = stringEnd(text, index);
    if (keyEnd < 0) return undefined;
    const key = JSON.parse(text.slice(index, keyEnd)) as string;
    index = skipWhitespace(text, keyEnd);
    if (text.charAt(index) !== ":") return undefined;
    index = skipWhitespace(text, index + 1);
    const end = valueEnd(text, index);
    if (end < 0) return undefined;
    if (wanted.has(key) && text.charAt(index) === '"') {
      strings.set(key, JSON.parse(text.slice(index, end)) as string);
    }
    index = skipWhitespace(text, end);
    if (text.charAt(index) === ",") index = skipWhitespace(text, index + 1);
    else if (text.charAt(index) !== "}") return undefined;
  }
  const snapshotId =
    strings.get("kind") === runSnapshotReferenceKind
      ? strings.get("snapshotId")
      : strings.get("id");
  const checksum = strings.get("checksum");
  return snapshotId !== undefined && checksum !== undefined ? { snapshotId, checksum } : undefined;
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
