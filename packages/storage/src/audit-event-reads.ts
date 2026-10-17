import { type AuditChainVerification, verifyAuditChain } from "./audit-chain-verification.js";
import type { AuditEvent } from "./ports/history.js";

type JsonValue = AuditEvent["payload"];

interface AuditReadStatement {
  readonly get: (...parameters: readonly unknown[]) => Record<string, unknown> | undefined;
  readonly all: (...parameters: readonly unknown[]) => readonly Record<string, unknown>[];
}

interface AuditReadDatabase {
  readonly prepare: (sql: string) => AuditReadStatement;
}

/** Identifies one entity's events of one type inside a workspace's audit trail. */
export interface LatestAuditEventQuery {
  readonly workspaceId: string;
  readonly eventType: string;
  readonly entityType: string;
  readonly entityId: string;
}

/**
 * Targeted reads of the audit trail. Listing a workspace's whole trail parses every payload, and a
 * run's trail repeats its large snapshots, so a reader that needs one event asks for that event.
 */
export interface AuditEventReadsPort {
  /** The newest matching event, or `undefined` when there is none. Parses only that payload. */
  readonly findLatestAuditEvent: (query: LatestAuditEventQuery) => Promise<AuditEvent | undefined>;
  /** Re-checks a workspace's chain and the run snapshots its snapshot events refer to. */
  readonly verifyAuditChain: (workspaceId: string) => Promise<AuditChainVerification>;
}

/** The columns of an audit event row, in the order the storage reads them. */
export const auditEventColumns =
  "sequence, id, workspace_id, event_type, entity_type, entity_id, payload_json, payload_checksum, previous_event_checksum, event_checksum, created_at";

function text(row: Record<string, unknown>, field: string): string {
  return String(row[field]);
}

function nullableText(row: Record<string, unknown>, field: string): string | null {
  const value = row[field];
  return value === null || value === undefined ? null : String(value);
}

export function auditFromRow(row: Record<string, unknown>): AuditEvent {
  return {
    sequence: Number(text(row, "sequence")),
    id: text(row, "id"),
    workspaceId: text(row, "workspace_id"),
    eventType: text(row, "event_type"),
    entityType: text(row, "entity_type"),
    entityId: text(row, "entity_id"),
    payload: JSON.parse(text(row, "payload_json")) as JsonValue,
    payloadChecksum: text(row, "payload_checksum"),
    previousEventChecksum: nullableText(row, "previous_event_checksum"),
    eventChecksum: text(row, "event_checksum"),
    createdAt: text(row, "created_at"),
  };
}

/**
 * The filter compares only the leading identity columns, so SQLite never reads the payloads of
 * the rows it skips; the trail is short in rows even when it is large in bytes.
 */
export const latestAuditEventSql = `SELECT ${auditEventColumns} FROM audit_events WHERE workspace_id = ? AND event_type = ? AND entity_type = ? AND entity_id = ? ORDER BY sequence DESC LIMIT 1`;

export function createAuditEventReads(
  database: AuditReadDatabase,
  ensureOpen: () => void,
): AuditEventReadsPort {
  return {
    findLatestAuditEvent: async ({ workspaceId, eventType, entityType, entityId }) => {
      ensureOpen();
      const row = database
        .prepare(latestAuditEventSql)
        .get(workspaceId, eventType, entityType, entityId);
      return row === undefined ? undefined : auditFromRow(row);
    },
    verifyAuditChain: async (workspaceId) => {
      ensureOpen();
      return verifyAuditChain(database, workspaceId);
    },
  };
}
