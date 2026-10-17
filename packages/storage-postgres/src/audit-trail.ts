import type { AuditEvent, AuditEventInput } from "@draft-loop/storage";
import {
  auditEventChecksum,
  auditEventColumns,
  auditFromRow,
  payloadChecksum,
  serialize,
} from "@draft-loop/storage/audit-trail";
import { StorageConflictError, StorageValidationError } from "@draft-loop/storage/errors";
import type { SqlExecutor } from "./sql-client.js";

const selectById = `SELECT ${auditEventColumns} FROM audit_events WHERE id = $1`;

/** The audit-chain lock namespace; the second key is the workspace id's hash. */
const auditChainLockNamespace = 0x61756474;

/**
 * Appends one audit event, chained to the workspace's previous one, inside the caller's
 * transaction. A transaction-scoped advisory lock per workspace serializes concurrent writers, so
 * two events never claim the same predecessor. The same id with the same content returns the
 * stored event; with other content it is a conflict, since audit events are immutable.
 */
export async function appendAuditEventRow(
  executor: SqlExecutor,
  input: AuditEventInput,
): Promise<AuditEvent> {
  if (input.id.trim() === "") throw new StorageValidationError("audit event id must not be empty");
  const payloadChecksumValue = payloadChecksum(input.payload);
  await executor.query("SELECT pg_advisory_xact_lock($1, hashtext($2))", [
    auditChainLockNamespace,
    input.workspaceId,
  ]);
  const [existing] = await executor.query(selectById, [input.id]);
  if (existing !== undefined) {
    const event = auditFromRow(existing);
    if (
      event.workspaceId !== input.workspaceId ||
      event.eventType !== input.eventType ||
      event.entityType !== input.entityType ||
      event.entityId !== input.entityId ||
      event.payloadChecksum !== payloadChecksumValue ||
      event.createdAt !== input.createdAt
    ) {
      throw new StorageConflictError(`audit event ${input.id} is immutable`);
    }
    return event;
  }
  const [previous] = await executor.query(
    "SELECT event_checksum FROM audit_events WHERE workspace_id = $1 ORDER BY sequence DESC LIMIT 1",
    [input.workspaceId],
  );
  const previousEventChecksum =
    typeof previous?.event_checksum === "string" ? previous.event_checksum : null;
  const eventChecksum = auditEventChecksum({
    createdAt: input.createdAt,
    entityId: input.entityId,
    entityType: input.entityType,
    eventType: input.eventType,
    id: input.id,
    payloadChecksum: payloadChecksumValue,
    previousEventChecksum,
    workspaceId: input.workspaceId,
  });
  const [row] = await executor.query(
    `INSERT INTO audit_events (id, workspace_id, event_type, entity_type, entity_id, payload_json, payload_checksum, previous_event_checksum, event_checksum, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING ${auditEventColumns}`,
    [
      input.id,
      input.workspaceId,
      input.eventType,
      input.entityType,
      input.entityId,
      serialize(input.payload),
      payloadChecksumValue,
      previousEventChecksum,
      eventChecksum,
      input.createdAt,
    ],
  );
  if (row === undefined) {
    throw new StorageConflictError(`audit event ${input.id} could not be read after insert`);
  }
  return auditFromRow(row);
}

/** A workspace's audit events in chain order. */
export async function listAuditEventRows(
  executor: SqlExecutor,
  workspaceId: string,
): Promise<readonly AuditEvent[]> {
  const rows = await executor.query(
    `SELECT ${auditEventColumns} FROM audit_events WHERE workspace_id = $1 ORDER BY sequence`,
    [workspaceId],
  );
  return rows.map(auditFromRow);
}
