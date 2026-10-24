import type {
  AuditEventInput,
  DecisionRecord,
  DecisionRecordInput,
  ExecutionRecord,
  ExecutionRecordInput,
  ExportRecord,
  ExportRecordInput,
  FindingRecord,
  FindingRecordInput,
  RoundRecord,
  RoundRecordInput,
  RunRecord,
  RunRecordInput,
  RunSnapshotRecord,
  RunSnapshotRecordInput,
} from "@draft-loop/storage";
import { serialize } from "@draft-loop/storage/audit-trail";
import { StorageConflictError } from "@draft-loop/storage/errors";
import {
  decisionAuditEvent,
  decisionFromRow,
  executionAuditEvent,
  executionFromRow,
  exportAuditEvent,
  exportFromRow,
  findingAuditEvent,
  findingFromRow,
  prepareDecisionRecord,
  prepareExecutionRecord,
  prepareExportRecord,
  prepareFindingRecord,
  prepareRoundRecord,
  prepareRunRecord,
  prepareRunSnapshot,
  requireNonEmpty,
  roundAuditEvent,
  roundFromRow,
  runAuditEvent,
  runFromRow,
  runSnapshotFromRow,
  runSnapshotRef,
} from "@draft-loop/storage/history-records";
import { appendAuditEventRow } from "./audit-trail.js";
import type { SqlRow, SqlSession } from "./sql-client.js";

const runColumns =
  "id, workspace_id, context_snapshot_id, state, round, current_step, budget_json, artifact_id, approval, total_cost_usd, started_at, updated_at, last_error_json, payload_json, record_checksum";
const runSnapshotColumns =
  "sequence, id, workspace_id, run_id, context_snapshot_id, state, round, current_step, budget_json, artifact_id, approval, total_cost_usd, started_at, updated_at, last_error_json, payload_json, record_checksum";
const roundColumns =
  "id, workspace_id, run_id, number, state, started_at, completed_at, evaluation_json, payload_json, record_checksum";
const executionColumns =
  "id, workspace_id, run_id, round_id, context_snapshot_id, artifact_id, attempt, step, status, provider, model_id, provider_request_id, output_checksum, input_tokens, output_tokens, total_tokens, estimated_usd, started_at, completed_at, error_code, output_json, payload_json, record_checksum";
const findingColumns =
  "id, workspace_id, run_id, round_id, execution_id, artifact_id, code, category, severity, message, claim_id, section_id, requirement_id, created_at, payload_json, record_checksum";
const decisionColumns =
  "id, workspace_id, run_id, round_id, artifact_id, type, rationale, actor, created_at, payload_json, record_checksum";
const exportColumns =
  "id, workspace_id, run_id, artifact_id, format, status, output_path, output_checksum, created_at, payload_json, record_checksum";

function nullableJson(value: Parameters<typeof serialize>[0] | null): string | null {
  return value === null ? null : serialize(value);
}

function placeholders(count: number): string {
  return Array.from({ length: count }, (_, index) => `$${index + 1}`).join(", ");
}

/**
 * The shared shape of every append-only run record: insert once with its audit event; an identical
 * re-save is a no-op, and a changed one is a conflict.
 */
async function appendRecord(
  client: SqlSession,
  table: string,
  label: string,
  columns: string,
  values: readonly unknown[],
  record: { readonly id: string; readonly checksum: string },
  audit: AuditEventInput,
): Promise<void> {
  await client.transaction(async (executor) => {
    const [inserted] = await executor.query(
      `INSERT INTO ${table} (${columns}) VALUES (${placeholders(values.length)}) ON CONFLICT (tenant_id, id) DO NOTHING RETURNING id`,
      values,
    );
    if (inserted === undefined) {
      const [existing] = await executor.query(
        `SELECT record_checksum FROM ${table} WHERE id = $1`,
        [record.id],
      );
      if (existing?.record_checksum !== record.checksum) {
        throw new StorageConflictError(`${label} ${record.id} is immutable`);
      }
      return;
    }
    await appendAuditEventRow(executor, audit);
  });
}

async function readOne<Record>(
  client: SqlSession,
  sql: string,
  id: string,
  fromRow: (row: SqlRow) => Record,
): Promise<Record | undefined> {
  const [row] = await client.query(sql, [id]);
  return row === undefined ? undefined : fromRow(row);
}

async function readMany<Record>(
  client: SqlSession,
  sql: string,
  id: string,
  fromRow: (row: SqlRow) => Record,
): Promise<readonly Record[]> {
  return (await client.query(sql, [id])).map(fromRow);
}

/**
 * Runs and their child records on Postgres. Validation, checksums, audit events and row mapping
 * come from `@draft-loop/storage/history-records`, the same code SQLite runs, and lists keep
 * SQLite's order.
 */
export function createRunHistory(client: SqlSession) {
  const getRunSnapshotById = (id: string) =>
    readOne(
      client,
      `SELECT ${runSnapshotColumns} FROM run_snapshots WHERE id = $1`,
      id,
      runSnapshotFromRow,
    );

  return {
    saveRun: async (input: RunRecordInput): Promise<RunRecord> => {
      const record = prepareRunRecord(input);
      await appendRecord(
        client,
        "runs",
        "run",
        runColumns,
        [
          record.id,
          record.workspaceId,
          record.contextSnapshotId,
          record.state,
          record.round,
          record.currentStep,
          serialize(record.budget),
          record.artifactId,
          record.approval,
          record.totalCostUsd,
          record.startedAt,
          record.updatedAt,
          nullableJson(record.lastError),
          serialize(record.payload),
          record.checksum,
        ],
        record,
        runAuditEvent(record),
      );
      return record;
    },
    getRun: (id: string) =>
      readOne(client, `SELECT ${runColumns} FROM runs WHERE id = $1`, id, runFromRow),
    listRuns: (workspaceId: string) => {
      requireNonEmpty(workspaceId, "run workspaceId");
      return readMany(
        client,
        `SELECT ${runColumns} FROM runs WHERE workspace_id = $1 ORDER BY updated_at, id`,
        workspaceId,
        runFromRow,
      );
    },

    saveRunSnapshot: async (input: RunSnapshotRecordInput): Promise<RunSnapshotRecord> => {
      const { id, checksum } = prepareRunSnapshot(input);
      await client.transaction(async (executor) => {
        const [inserted] = await executor.query(
          `INSERT INTO run_snapshots (${runSnapshotColumns.replace("sequence, ", "")}) VALUES (${placeholders(16)}) ON CONFLICT (tenant_id, id) DO NOTHING RETURNING sequence`,
          [
            id,
            input.workspaceId,
            input.runId,
            input.contextSnapshotId,
            input.state,
            input.round,
            input.currentStep,
            serialize(input.budget),
            input.artifactId,
            input.approval,
            input.totalCostUsd,
            input.startedAt,
            input.updatedAt,
            nullableJson(input.lastError),
            serialize(input.payload),
            checksum,
          ],
        );
        if (inserted === undefined) {
          const [existing] = await executor.query(
            "SELECT record_checksum FROM run_snapshots WHERE id = $1",
            [id],
          );
          if (existing?.record_checksum !== checksum) {
            throw new StorageConflictError(`run snapshot ${id} is immutable`);
          }
          return;
        }
        await appendAuditEventRow(executor, {
          id: `${id}:audit`,
          workspaceId: input.workspaceId,
          eventType: "run-snapshot.appended",
          entityType: "run-snapshot",
          entityId: input.runId,
          payload: runSnapshotRef(id, input.runId, Number(inserted.sequence), checksum),
          createdAt: input.updatedAt,
        });
      });
      const saved = await getRunSnapshotById(id);
      if (saved === undefined) {
        throw new StorageConflictError(`run snapshot ${id} could not be read after insert`);
      }
      return saved;
    },
    getLatestRunSnapshot: (runId: string) => {
      requireNonEmpty(runId, "run snapshot runId");
      return readOne(
        client,
        `SELECT ${runSnapshotColumns} FROM run_snapshots WHERE run_id = $1 ORDER BY sequence DESC LIMIT 1`,
        runId,
        runSnapshotFromRow,
      );
    },
    listRunSnapshots: (runId: string) => {
      requireNonEmpty(runId, "run snapshot runId");
      return readMany(
        client,
        `SELECT ${runSnapshotColumns} FROM run_snapshots WHERE run_id = $1 ORDER BY sequence, id`,
        runId,
        runSnapshotFromRow,
      );
    },

    saveRound: async (input: RoundRecordInput): Promise<RoundRecord> => {
      const record = prepareRoundRecord(input);
      await appendRecord(
        client,
        "rounds",
        "round",
        roundColumns,
        [
          record.id,
          record.workspaceId,
          record.runId,
          record.number,
          record.state,
          record.startedAt,
          record.completedAt,
          nullableJson(record.evaluation),
          serialize(record.payload),
          record.checksum,
        ],
        record,
        roundAuditEvent(record),
      );
      return record;
    },
    getRound: (id: string) =>
      readOne(client, `SELECT ${roundColumns} FROM rounds WHERE id = $1`, id, roundFromRow),
    listRounds: (runId: string) => {
      requireNonEmpty(runId, "round runId");
      return readMany(
        client,
        `SELECT ${roundColumns} FROM rounds WHERE run_id = $1 ORDER BY number, id`,
        runId,
        roundFromRow,
      );
    },

    saveExecution: async (input: ExecutionRecordInput): Promise<ExecutionRecord> => {
      const record = prepareExecutionRecord(input);
      await appendRecord(
        client,
        "executions",
        "execution",
        executionColumns,
        [
          record.id,
          record.workspaceId,
          record.runId,
          record.roundId,
          record.contextSnapshotId,
          record.artifactId,
          record.attempt,
          record.step,
          record.status,
          record.provider,
          record.modelId,
          record.providerRequestId,
          record.outputChecksum,
          record.inputTokens,
          record.outputTokens,
          record.totalTokens,
          record.estimatedUsd,
          record.startedAt,
          record.completedAt,
          record.errorCode,
          nullableJson(record.output),
          serialize(record.payload),
          record.checksum,
        ],
        record,
        executionAuditEvent(record),
      );
      return record;
    },
    getExecution: (id: string) =>
      readOne(
        client,
        `SELECT ${executionColumns} FROM executions WHERE id = $1`,
        id,
        executionFromRow,
      ),
    listExecutions: (runId: string) => {
      requireNonEmpty(runId, "execution runId");
      return readMany(
        client,
        `SELECT ${executionColumns} FROM executions WHERE run_id = $1 ORDER BY started_at, id`,
        runId,
        executionFromRow,
      );
    },

    saveFinding: async (input: FindingRecordInput): Promise<FindingRecord> => {
      const record = prepareFindingRecord(input);
      await appendRecord(
        client,
        "findings",
        "finding",
        findingColumns,
        [
          record.id,
          record.workspaceId,
          record.runId,
          record.roundId,
          record.executionId,
          record.artifactId,
          record.code,
          record.category,
          record.severity,
          record.message,
          record.claimId,
          record.sectionId,
          record.requirementId,
          record.createdAt,
          serialize(record.payload),
          record.checksum,
        ],
        record,
        findingAuditEvent(record),
      );
      return record;
    },
    getFinding: (id: string) =>
      readOne(client, `SELECT ${findingColumns} FROM findings WHERE id = $1`, id, findingFromRow),
    listFindings: (runId: string) => {
      requireNonEmpty(runId, "finding runId");
      return readMany(
        client,
        `SELECT ${findingColumns} FROM findings WHERE run_id = $1 ORDER BY created_at, id`,
        runId,
        findingFromRow,
      );
    },

    saveDecision: async (input: DecisionRecordInput): Promise<DecisionRecord> => {
      const record = prepareDecisionRecord(input);
      await appendRecord(
        client,
        "decisions",
        "decision",
        decisionColumns,
        [
          record.id,
          record.workspaceId,
          record.runId,
          record.roundId,
          record.artifactId,
          record.type,
          record.rationale,
          record.actor,
          record.createdAt,
          serialize(record.payload),
          record.checksum,
        ],
        record,
        decisionAuditEvent(record),
      );
      return record;
    },
    getDecision: (id: string) =>
      readOne(
        client,
        `SELECT ${decisionColumns} FROM decisions WHERE id = $1`,
        id,
        decisionFromRow,
      ),
    listDecisions: (runId: string) => {
      requireNonEmpty(runId, "decision runId");
      return readMany(
        client,
        `SELECT ${decisionColumns} FROM decisions WHERE run_id = $1 ORDER BY created_at, id`,
        runId,
        decisionFromRow,
      );
    },

    saveExport: async (input: ExportRecordInput): Promise<ExportRecord> => {
      const record = prepareExportRecord(input);
      await appendRecord(
        client,
        "exports",
        "export",
        exportColumns,
        [
          record.id,
          record.workspaceId,
          record.runId,
          record.artifactId,
          record.format,
          record.status,
          record.outputPath,
          record.outputChecksum,
          record.createdAt,
          serialize(record.payload),
          record.checksum,
        ],
        record,
        exportAuditEvent(record),
      );
      return record;
    },
    getExport: (id: string) =>
      readOne(client, `SELECT ${exportColumns} FROM exports WHERE id = $1`, id, exportFromRow),
    listExports: (runId: string) => {
      requireNonEmpty(runId, "export runId");
      return readMany(
        client,
        `SELECT ${exportColumns} FROM exports WHERE run_id = $1 ORDER BY created_at, id`,
        runId,
        exportFromRow,
      );
    },
  };
}
