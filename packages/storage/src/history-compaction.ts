import { statSync } from "node:fs";

import {
  type AuditChainVerification,
  snapshotRowChecksum,
  verifyAuditChain,
} from "./audit-chain-verification.js";
import {
  auditEventChecksum,
  checksum,
  insertAuditEventRow,
  serialize,
} from "./audit-event-write.js";
import { relieveMemoryPressure } from "./memory-pressure.js";
import type { AuditEventInput } from "./ports/history.js";
import type { JsonValue } from "./ports/workspace.js";
import {
  runSnapshotAuditEventType,
  runSnapshotRef,
  runSnapshotTarget,
  runSnapshotTargetFromText,
} from "./run-snapshot-audit.js";
import { loadSqlite } from "./sqlite-handle.js";

export { relieveMemoryPressure };

/**
 * `verifyAuditChain` on a history file, read only, collecting garbage between pages: a legacy
 * history holds events and snapshot rows of many megabytes each.
 */
export function verifyHistoryChain(
  databasePath: string,
  workspaceId: string,
): AuditChainVerification {
  const database = loadSqlite(databasePath, { readOnly: true, fileMustExist: true });
  try {
    return verifyAuditChain(
      {
        prepare: (sql) => {
          const statement = database.prepare(sql);
          return {
            get: (...parameters) => statement.get(...parameters),
            all: (...parameters) => {
              relieveMemoryPressure();
              return statement.all(...parameters);
            },
          };
        },
      },
      workspaceId,
    );
  } finally {
    database.close();
  }
}

/**
 * Rewrites a history database file so legacy run history takes less space, without leaving the
 * audit chain broken. It works only on a file the caller has copied for the purpose, never on the
 * workspace's live database: `audit_events` and `run_snapshots` are immutable there, and the copy
 * is the one place their triggers are lifted, inside one transaction that puts them back.
 *
 * - Run snapshot rows are rewritten to the payload the caller supplies (a slim row).
 * - Every `run-snapshot.appended` event, legacy full payload or reference, becomes a reference to
 *   the rewritten row, and every event's link and checksum is recomputed along the chain.
 * - Other events keep their payload and payload checksum.
 */

export interface CompactionSnapshotRow {
  readonly sequence: number;
  readonly id: string;
  readonly runId: string;
  readonly payload: JsonValue;
}

export interface HistoryCompactionSummary {
  readonly previousEventCount: number;
  /** The old chain's last event checksum, `null` when the workspace had no events. */
  readonly previousHeadChecksum: string | null;
  readonly rewrittenSnapshots: number;
  readonly rewrittenEvents: number;
}

export interface HistoryCompactionOptions {
  readonly workspaceId: string;
  /** The payload to store for a snapshot row; return the input payload itself to keep the row. */
  readonly rewritePayload: (row: CompactionSnapshotRow) => Promise<JsonValue>;
  /** Builds the event that records the compaction, once the file has been vacuumed. */
  readonly compactionEvent: (
    summary: HistoryCompactionSummary & { readonly databaseBytes: number },
  ) => AuditEventInput;
}

function parseJson(text: unknown): JsonValue {
  return JSON.parse(String(text)) as JsonValue;
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

/** Walks a workspace's snapshot rows in sequence order, holding one payload at a time. */
export async function* readSnapshotRows(
  databasePath: string,
  workspaceId: string,
): AsyncGenerator<CompactionSnapshotRow> {
  const database = loadSqlite(databasePath, { readOnly: true, fileMustExist: true });
  try {
    const next = database.prepare(
      "SELECT sequence, id, run_id, payload_json FROM run_snapshots WHERE workspace_id = ? AND sequence > ? ORDER BY sequence LIMIT 1",
    );
    let last = 0;
    for (;;) {
      const row = next.get(workspaceId, last);
      if (row === undefined) return;
      last = Number(row.sequence);
      yield {
        sequence: last,
        id: String(row.id),
        runId: String(row.run_id),
        payload: parseJson(row.payload_json),
      };
    }
  } finally {
    database.close();
  }
}

/**
 * Copies a history file through SQLite's online backup, which gives a consistent copy even if the
 * file is open elsewhere. Unlike `SqliteStorage.createBackup` it does not read the finished copy
 * back into memory to hash it, which costs the whole file size in memory.
 */
export async function backupHistoryDatabase(
  sourcePath: string,
  destinationPath: string,
): Promise<{ readonly sizeBytes: number }> {
  const database = loadSqlite(sourcePath, { readOnly: true, fileMustExist: true });
  try {
    await database.backup(destinationPath);
  } finally {
    database.close();
  }
  return { sizeBytes: statSync(destinationPath).size };
}

interface RewrittenSnapshot {
  readonly id: string;
  readonly checksum: string;
  readonly payloadJson: string;
}

/**
 * Compacts the history file at `databasePath` in place, then vacuums it and appends the event
 * `compactionEvent` describes. Failure leaves the caller's file in an unknown state, so the caller
 * must pass a throwaway copy.
 */
export async function compactHistoryDatabase(
  databasePath: string,
  options: HistoryCompactionOptions,
): Promise<HistoryCompactionSummary> {
  const { workspaceId } = options;
  const database = loadSqlite(databasePath, { fileMustExist: true });
  try {
    // Phase one reads each row alone, because the callback writes the executions and drafts the
    // slim rows refer to into the same file.
    const rewritten = new Map<string, RewrittenSnapshot>();
    const fields = database.prepare(
      "SELECT workspace_id, run_id, context_snapshot_id, state, round, current_step, budget_json, artifact_id, approval, total_cost_usd, started_at, updated_at, last_error_json FROM run_snapshots WHERE sequence = ?",
    );
    for await (const row of readSnapshotRows(databasePath, workspaceId)) {
      relieveMemoryPressure();
      const payload = await options.rewritePayload(row);
      if (payload === row.payload) continue;
      const payloadJson = serialize(payload);
      const stored = fields.get(row.sequence);
      if (stored === undefined) continue;
      const rowChecksum = snapshotRowChecksum({ ...stored, payload_json: payloadJson });
      rewritten.set(row.id, {
        id: `run-snapshot:${row.runId}:${rowChecksum}`,
        checksum: rowChecksum,
        payloadJson,
      });
    }

    const summary = database.transaction((): HistoryCompactionSummary => {
      const triggers = database
        .prepare(
          "SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name IN ('audit_events', 'run_snapshots')",
        )
        .all();
      for (const trigger of triggers) database.exec(`DROP TRIGGER "${String(trigger.name)}"`);

      const updateSnapshot = database.prepare(
        "UPDATE run_snapshots SET id = ?, payload_json = ?, record_checksum = ? WHERE id = ?",
      );
      for (const [oldId, next] of rewritten) {
        updateSnapshot.run(next.id, next.payloadJson, next.checksum, oldId);
      }

      const page = database.prepare(
        "SELECT sequence, id, event_type, entity_type, entity_id, payload_json, payload_checksum, previous_event_checksum, event_checksum, created_at FROM audit_events WHERE workspace_id = ? AND sequence > ? ORDER BY sequence LIMIT 2",
      );
      const snapshotById = database.prepare(
        "SELECT sequence, run_id, record_checksum FROM run_snapshots WHERE id = ?",
      );
      const update = database.prepare(
        "UPDATE audit_events SET payload_json = ?, payload_checksum = ?, previous_event_checksum = ?, event_checksum = ? WHERE sequence = ?",
      );
      let lastSequence = 0;
      let previousEventCount = 0;
      let previousHead: string | null = null;
      let head: string | null = null;
      let rewrittenEvents = 0;
      for (;;) {
        relieveMemoryPressure();
        const rows = page.all(workspaceId, lastSequence);
        if (rows.length === 0) break;
        for (const row of rows) {
          lastSequence = Number(row.sequence);
          const isFirst = previousEventCount === 0;
          previousEventCount += 1;
          previousHead = String(row.event_checksum);
          let payloadJson = String(row.payload_json);
          let payloadChecksum = String(row.payload_checksum);
          if (row.event_type === runSnapshotAuditEventType) {
            // The chain was verified before this copy was made, so the text is scanned, not parsed.
            const target =
              runSnapshotTargetFromText(payloadJson) ?? runSnapshotTarget(parseJson(payloadJson));
            if (target === undefined) throw new Error("A run snapshot event names no snapshot.");
            const snapshotId = rewritten.get(target.snapshotId)?.id ?? target.snapshotId;
            const snapshot = snapshotById.get(snapshotId);
            if (snapshot === undefined)
              throw new Error("A run snapshot event names a missing row.");
            const reference = serialize(
              runSnapshotRef(
                snapshotId,
                String(snapshot.run_id),
                Number(snapshot.sequence),
                String(snapshot.record_checksum),
              ),
            );
            if (reference !== payloadJson) {
              payloadJson = reference;
              payloadChecksum = checksum(reference);
            }
          }
          // The first event keeps its predecessor, since retention may have removed the head.
          const storedPrevious = nullableString(row.previous_event_checksum);
          const previous = isFirst ? storedPrevious : head;
          const eventChecksum = auditEventChecksum({
            createdAt: String(row.created_at),
            entityId: String(row.entity_id),
            entityType: String(row.entity_type),
            eventType: String(row.event_type),
            id: String(row.id),
            payloadChecksum,
            previousEventChecksum: previous,
            workspaceId,
          });
          if (
            payloadJson !== String(row.payload_json) ||
            previous !== storedPrevious ||
            eventChecksum !== String(row.event_checksum)
          ) {
            update.run(payloadJson, payloadChecksum, previous, eventChecksum, lastSequence);
            rewrittenEvents += 1;
          }
          head = eventChecksum;
        }
      }
      for (const trigger of triggers) database.exec(String(trigger.sql));
      return {
        previousEventCount,
        previousHeadChecksum: previousHead,
        rewrittenSnapshots: rewritten.size,
        rewrittenEvents,
      };
    })();

    database.pragma("wal_checkpoint(TRUNCATE)");
    database.exec("VACUUM");
    insertAuditEventRow(
      database,
      options.compactionEvent({ ...summary, databaseBytes: statSync(databasePath).size }),
    );
    return summary;
  } finally {
    database.close();
  }
}
