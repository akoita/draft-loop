import { auditEventChecksum, checksum, serialize } from "./audit-event-write.js";
import type { AuditEvent } from "./index.js";
import {
  runSnapshotAuditEventType,
  runSnapshotTarget,
  runSnapshotTargetFromText,
} from "./run-snapshot-audit.js";

type JsonValue = AuditEvent["payload"];

interface VerifyStatement {
  readonly get: (...parameters: readonly unknown[]) => Record<string, unknown> | undefined;
  readonly all: (...parameters: readonly unknown[]) => readonly Record<string, unknown>[];
}

export interface AuditChainDatabase {
  readonly prepare: (sql: string) => VerifyStatement;
}

export interface AuditChainProblem {
  readonly eventId: string;
  readonly sequence: number;
  readonly code:
    | "payload-checksum"
    | "event-checksum"
    | "chain-link"
    | "snapshot-missing"
    | "snapshot-checksum";
  readonly message: string;
}

export interface AuditChainVerification {
  readonly ok: boolean;
  readonly eventCount: number;
  readonly problems: readonly AuditChainProblem[];
}

// Legacy snapshot events held whole snapshots of many megabytes, so a page must stay small.
const pageSize = 2;

function parseJson(text: string): JsonValue | undefined {
  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    return undefined;
  }
}

function nullableJson(value: unknown): JsonValue {
  return value === null || value === undefined ? null : (parseJson(String(value)) ?? null);
}

function snapshotRowRecord(row: Record<string, unknown>, payload: JsonValue): JsonValue {
  return {
    workspaceId: String(row.workspace_id),
    runId: String(row.run_id),
    contextSnapshotId: String(row.context_snapshot_id),
    state: String(row.state),
    round: Number(row.round),
    currentStep: row.current_step === null ? null : String(row.current_step),
    budget: nullableJson(row.budget_json),
    artifactId: row.artifact_id === null ? null : String(row.artifact_id),
    approval: String(row.approval),
    totalCostUsd: Number(row.total_cost_usd),
    startedAt: String(row.started_at),
    updatedAt: String(row.updated_at),
    lastError: nullableJson(row.last_error_json),
    payload,
  };
}

/** Recomputes a snapshot row's own checksum the way `saveRunSnapshot` computed it. */
export function snapshotRowChecksum(row: Record<string, unknown>): string {
  return checksum(serialize(snapshotRowRecord(row, nullableJson(row.payload_json))));
}

const payloadPlaceholder = "\u0000payload";

/**
 * The same checksum computed without parsing the payload: the payload is stored already
 * serialized, so its text is spliced into the serialized record. A multi-megabyte legacy payload
 * then costs string copies instead of a parsed and canonicalized object graph. When the text is not
 * the canonical form the result differs, and the caller falls back to `snapshotRowChecksum`.
 */
function snapshotRowChecksumFromText(row: Record<string, unknown>): string | undefined {
  const record = serialize(snapshotRowRecord(row, payloadPlaceholder));
  const quoted = JSON.stringify(payloadPlaceholder);
  const at = record.indexOf(quoted);
  if (at < 0) return undefined;
  return checksum(
    `${record.slice(0, at)}${String(row.payload_json)}${record.slice(at + quoted.length)}`,
  );
}

/**
 * Walks a workspace's audit chain in order and reports every break. Each event is checked as it is
 * stored: its payload against its payload checksum, its fields against its event checksum, and its
 * link to the previous event. Snapshot events, in either shape, also name a `run_snapshots` row;
 * that row must exist and match both the checksum the event holds and its own recomputed checksum.
 * The first event's predecessor is not checked, since retention may have removed the head.
 */
export function verifyAuditChain(
  database: AuditChainDatabase,
  workspaceId: string,
): AuditChainVerification {
  const problems: AuditChainProblem[] = [];
  const page = database.prepare(
    "SELECT sequence, id, event_type, entity_type, entity_id, payload_json, payload_checksum, previous_event_checksum, event_checksum, created_at FROM audit_events WHERE workspace_id = ? AND sequence > ? ORDER BY sequence LIMIT ?",
  );
  const snapshotRow = database.prepare(
    "SELECT workspace_id, run_id, context_snapshot_id, state, round, current_step, budget_json, artifact_id, approval, total_cost_usd, started_at, updated_at, last_error_json, payload_json, record_checksum FROM run_snapshots WHERE id = ?",
  );
  let lastSequence = 0;
  let previousChecksum: string | undefined;
  let eventCount = 0;
  for (;;) {
    const rows = page.all(workspaceId, lastSequence, pageSize);
    if (rows.length === 0) break;
    for (const row of rows) {
      const id = String(row.id);
      const sequence = Number(row.sequence);
      const report = (code: AuditChainProblem["code"], message: string): void => {
        problems.push({ eventId: id, sequence, code, message });
      };
      lastSequence = sequence;
      eventCount += 1;
      const payloadText = String(row.payload_json);
      const payloadChecksum = String(row.payload_checksum);
      // The stored text is the canonical form, so hashing it directly is the cheap path; only text
      // that does not hash to the stored checksum is parsed and canonicalized, as it always was.
      const canonical = checksum(payloadText) === payloadChecksum;
      if (!canonical) {
        const parsed = parseJson(payloadText);
        if (parsed === undefined || checksum(serialize(parsed)) !== payloadChecksum) {
          report("payload-checksum", `audit event ${id} payload does not match its checksum`);
        }
      }
      const previous =
        row.previous_event_checksum === null ? null : String(row.previous_event_checksum);
      const recomputed = auditEventChecksum({
        createdAt: String(row.created_at),
        entityId: String(row.entity_id),
        entityType: String(row.entity_type),
        eventType: String(row.event_type),
        id,
        payloadChecksum,
        previousEventChecksum: previous,
        workspaceId,
      });
      if (recomputed !== String(row.event_checksum)) {
        report("event-checksum", `audit event ${id} does not match its event checksum`);
      }
      if (previousChecksum !== undefined && previous !== previousChecksum) {
        report("chain-link", `audit event ${id} does not follow the previous event`);
      }
      previousChecksum = String(row.event_checksum);
      if (row.event_type !== runSnapshotAuditEventType) continue;
      // A verified payload is read by scanning its text, since a legacy one holds a whole snapshot.
      let target = canonical ? runSnapshotTargetFromText(payloadText) : undefined;
      if (target === undefined) {
        const parsed = parseJson(payloadText);
        if (parsed === undefined) continue;
        target = runSnapshotTarget(parsed);
      }
      if (target === undefined) {
        report("snapshot-missing", `audit event ${id} does not name a run snapshot`);
        continue;
      }
      const snapshot = snapshotRow.get(target.snapshotId);
      if (snapshot === undefined) {
        report("snapshot-missing", `run snapshot ${target.snapshotId} is missing`);
      } else if (
        String(snapshot.record_checksum) !== target.checksum ||
        (snapshotRowChecksumFromText(snapshot) !== target.checksum &&
          snapshotRowChecksum(snapshot) !== target.checksum)
      ) {
        report(
          "snapshot-checksum",
          `run snapshot ${target.snapshotId} does not match its checksum`,
        );
      }
    }
  }
  return { ok: problems.length === 0, eventCount, problems };
}
