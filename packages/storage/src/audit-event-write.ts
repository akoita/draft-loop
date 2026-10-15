import { createHash } from "node:crypto";
import { auditFromRow } from "./audit-event-reads.js";
import type { AuditEvent, AuditEventInput } from "./index.js";
import {
  StorageConflictError,
  StorageSecurityError,
  StorageValidationError,
} from "./storage-errors.js";

/**
 * Canonical payload hashing and the append-only, checksum-chained audit insert. Kept apart from the
 * storage class so a feature store can append its audit event inside its own transaction, against
 * the same database, with the same chain.
 */

type JsonValue = AuditEvent["payload"];

interface AuditWriteStatement {
  readonly get: (...parameters: readonly unknown[]) => Record<string, unknown> | undefined;
  readonly run: (...parameters: readonly unknown[]) => unknown;
}

export interface AuditWriteDatabase {
  readonly prepare: (sql: string) => AuditWriteStatement;
}

export const sensitiveKeyPattern =
  /(?:api(?:[-_ ]?key)|(?:api|access|refresh|provider|auth)[-_ ]?token|(?:^|[-_.])token$|secret|password|credential|authorization)/iu;
const hiddenContentKeyPattern =
  /(?:^|[-_.])(?:prompt|response|raw[-_ ]?response|chain[-_ ]?of[-_ ]?thought|reasoning)(?:$|[-_ ])/iu;

export function checksum(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalize(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]),
  );
}

export function serialize(value: JsonValue): string {
  return JSON.stringify(canonicalize(value));
}

export function assertSafePayload(value: JsonValue): void {
  if (Array.isArray(value)) {
    value.forEach(assertSafePayload);
    return;
  }
  if (typeof value !== "object" || value === null) {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (sensitiveKeyPattern.test(key)) {
      throw new StorageSecurityError(`Sensitive field ${key} is not persisted.`);
    }
    if (hiddenContentKeyPattern.test(key)) {
      throw new StorageSecurityError(`Raw model content field ${key} is not persisted.`);
    }
    assertSafePayload(child);
  }
}

export function payloadChecksum(payload: JsonValue): string {
  assertSafePayload(payload);
  return checksum(serialize(payload));
}

const auditEventSelect =
  "SELECT sequence, id, workspace_id, event_type, entity_type, entity_id, payload_json, payload_checksum, previous_event_checksum, event_checksum, created_at FROM audit_events WHERE id = ?";

/**
 * Appends one audit event, chained to the workspace's previous one. Run it inside the caller's
 * transaction. The same id with the same content returns the stored event; with other content it
 * is a conflict, since audit events are immutable.
 */
export function insertAuditEventRow(
  database: AuditWriteDatabase,
  input: AuditEventInput,
): AuditEvent {
  if (input.id.trim() === "") throw new StorageValidationError("audit event id must not be empty");
  const payloadChecksumValue = payloadChecksum(input.payload);
  const existing = database.prepare(auditEventSelect).get(input.id);
  if (existing !== undefined) {
    const existingEvent = auditFromRow(existing);
    if (
      existingEvent.workspaceId !== input.workspaceId ||
      existingEvent.eventType !== input.eventType ||
      existingEvent.entityType !== input.entityType ||
      existingEvent.entityId !== input.entityId ||
      existingEvent.payloadChecksum !== payloadChecksumValue ||
      existingEvent.createdAt !== input.createdAt
    ) {
      throw new StorageConflictError(`audit event ${input.id} is immutable`);
    }
    return existingEvent;
  }
  const previous = database
    .prepare(
      "SELECT event_checksum FROM audit_events WHERE workspace_id = ? ORDER BY sequence DESC LIMIT 1",
    )
    .get(input.workspaceId);
  const previousEventChecksum =
    typeof previous?.event_checksum === "string" ? previous.event_checksum : null;
  const eventChecksum = checksum(
    serialize({
      createdAt: input.createdAt,
      entityId: input.entityId,
      entityType: input.entityType,
      eventType: input.eventType,
      id: input.id,
      payloadChecksum: payloadChecksumValue,
      previousEventChecksum,
      workspaceId: input.workspaceId,
    }),
  );
  database
    .prepare(
      "INSERT INTO audit_events (id, workspace_id, event_type, entity_type, entity_id, payload_json, payload_checksum, previous_event_checksum, event_checksum, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
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
    );
  const row = database.prepare(auditEventSelect).get(input.id);
  if (row === undefined) {
    throw new StorageConflictError(`audit event ${input.id} could not be read after insert`);
  }
  return auditFromRow(row);
}
