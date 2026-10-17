/**
 * The audit-trail building blocks another storage implementation reuses, so its records hash and
 * chain exactly as SQLite's do: canonical serialization, payload and chain checksums, and the row
 * mapping.
 */
export { auditEventColumns, auditFromRow } from "./audit-event-reads.js";
export { auditEventChecksum, payloadChecksum, serialize } from "./audit-event-write.js";
