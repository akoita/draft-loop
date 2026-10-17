/**
 * The audit-trail building blocks another storage implementation reuses, so its records hash and
 * chain exactly as SQLite's do: canonical serialization, payload and chain checksums, the row
 * mapping, and the chain walk that verification drives.
 */
export {
  type AuditChainSnapshotTarget,
  type AuditChainVerification,
  type AuditChainWalk,
  auditChainEventColumns,
  auditChainPageSize,
  auditChainSnapshotColumns,
  startAuditChainWalk,
} from "./audit-chain-verification.js";
export {
  type AuditEventReadsPort,
  auditEventColumns,
  auditFromRow,
  type LatestAuditEventQuery,
} from "./audit-event-reads.js";
export { auditEventChecksum, payloadChecksum, serialize } from "./audit-event-write.js";
