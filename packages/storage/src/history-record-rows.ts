import { workflowStates } from "@draft-loop/domain";
import { checksum, payloadChecksum, serialize } from "./audit-event-write.js";
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
  StoredApprovalStatus,
  StoredDecisionType,
  StoredExecutionStatus,
  StoredExecutionStep,
  StoredExportStatus,
  StoredFindingSeverity,
  StoredRoundState,
  StoredRunState,
  StoredRunStep,
} from "./ports/history.js";
import type { JsonValue } from "./ports/workspace.js";
import { StorageValidationError } from "./storage-errors.js";

export { runSnapshotRef } from "./run-snapshot-audit.js";

/**
 * Run-history validation, checksums, audit events and row mapping, shared by every storage
 * implementation so a record validates, hashes and audits the same way in SQLite and Postgres.
 * Row mappers accept any driver's row, keyed by the shared column names.
 */

export function parse(value: string): JsonValue {
  return JSON.parse(value) as JsonValue;
}

export function recordToJson(record: unknown): JsonValue {
  return JSON.parse(JSON.stringify(record)) as JsonValue;
}

export function requireNonEmpty(value: string, field: string): string {
  if (value.trim() === "") {
    throw new StorageValidationError(`${field} must not be empty`);
  }
  return value;
}

export function rowString(row: Record<string, unknown>, field: string): string {
  return String(row[field]);
}

export function rowNumber(row: Record<string, unknown>, field: string): number {
  return Number(row[field]);
}

export function rowNullableString(row: Record<string, unknown>, field: string): string | null {
  const value = row[field];
  return value === null || value === undefined ? null : String(value);
}

export function rowNullableJson(row: Record<string, unknown>, field: string): JsonValue | null {
  const value = row[field];
  return value === null || value === undefined ? null : parse(String(value));
}

export function rowNullableNumber(row: Record<string, unknown>, field: string): number | null {
  const value = row[field];
  return value === null || value === undefined ? null : Number(value);
}

export function recordChecksum(input: unknown): string {
  return checksum(serialize(recordToJson(input)));
}

export function assertSafeRecordFields(input: unknown, fields: readonly string[]): void {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return;
  const record = input as Record<string, unknown>;
  for (const field of fields) {
    const value = record[field];
    if (value !== null && value !== undefined) {
      payloadChecksum(recordToJson(value));
    }
  }
}

export function requirePositive(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new StorageValidationError(`${field} must be a positive integer`);
  }
  return value;
}

export function requireNonNegativeInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new StorageValidationError(`${field} must be a non-negative integer`);
  }
  return value;
}

export function requireNonNegativeNumber(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new StorageValidationError(`${field} must be a finite non-negative number`);
  }
  return value;
}

export function requireStoredRunState(state: StoredRunState, field: string): void {
  if (state !== "provider-error" && !workflowStates.includes(state)) {
    throw new StorageValidationError(`Unsupported ${field}: ${state}`);
  }
}

export function requireStoredStep(step: StoredRunStep, field: string): void {
  if (step !== null && step !== "author" && step !== "critic" && step !== "revision") {
    throw new StorageValidationError(`Unsupported ${field}: ${step}`);
  }
}

export function runFromRow(row: Record<string, unknown>): RunRecord {
  return {
    id: rowString(row, "id"),
    workspaceId: rowString(row, "workspace_id"),
    contextSnapshotId: rowString(row, "context_snapshot_id"),
    state: rowString(row, "state") as StoredRunState,
    round: rowNumber(row, "round"),
    currentStep: rowNullableString(row, "current_step") as StoredRunStep,
    budget: parse(rowString(row, "budget_json")),
    artifactId: rowNullableString(row, "artifact_id"),
    approval: rowString(row, "approval") as StoredApprovalStatus,
    totalCostUsd: rowNumber(row, "total_cost_usd"),
    startedAt: rowString(row, "started_at"),
    updatedAt: rowString(row, "updated_at"),
    lastError: rowNullableJson(row, "last_error_json"),
    payload: parse(rowString(row, "payload_json")),
    checksum: rowString(row, "record_checksum"),
  };
}

export function runSnapshotFromRow(row: Record<string, unknown>): RunSnapshotRecord {
  return {
    sequence: rowNumber(row, "sequence"),
    id: rowString(row, "id"),
    workspaceId: rowString(row, "workspace_id"),
    runId: rowString(row, "run_id"),
    contextSnapshotId: rowString(row, "context_snapshot_id"),
    state: rowString(row, "state") as StoredRunState,
    round: rowNumber(row, "round"),
    currentStep: rowNullableString(row, "current_step") as StoredRunStep,
    budget: parse(rowString(row, "budget_json")),
    artifactId: rowNullableString(row, "artifact_id"),
    approval: rowString(row, "approval") as StoredApprovalStatus,
    totalCostUsd: rowNumber(row, "total_cost_usd"),
    startedAt: rowString(row, "started_at"),
    updatedAt: rowString(row, "updated_at"),
    lastError: rowNullableJson(row, "last_error_json"),
    payload: parse(rowString(row, "payload_json")),
    checksum: rowString(row, "record_checksum"),
  };
}

export function roundFromRow(row: Record<string, unknown>): RoundRecord {
  return {
    id: rowString(row, "id"),
    workspaceId: rowString(row, "workspace_id"),
    runId: rowString(row, "run_id"),
    number: rowNumber(row, "number"),
    state: rowString(row, "state") as StoredRoundState,
    startedAt: rowString(row, "started_at"),
    completedAt: rowNullableString(row, "completed_at"),
    evaluation: rowNullableJson(row, "evaluation_json"),
    payload: parse(rowString(row, "payload_json")),
    checksum: rowString(row, "record_checksum"),
  };
}

export function executionFromRow(row: Record<string, unknown>): ExecutionRecord {
  return {
    id: rowString(row, "id"),
    workspaceId: rowString(row, "workspace_id"),
    runId: rowString(row, "run_id"),
    roundId: rowString(row, "round_id"),
    contextSnapshotId: rowString(row, "context_snapshot_id"),
    artifactId: rowNullableString(row, "artifact_id"),
    attempt: rowNumber(row, "attempt"),
    step: rowString(row, "step") as StoredExecutionStep,
    status: rowString(row, "status") as StoredExecutionStatus,
    provider: rowString(row, "provider"),
    modelId: rowString(row, "model_id"),
    providerRequestId: rowNullableString(row, "provider_request_id"),
    outputChecksum: rowNullableString(row, "output_checksum"),
    inputTokens: rowNumber(row, "input_tokens"),
    outputTokens: rowNumber(row, "output_tokens"),
    totalTokens: rowNumber(row, "total_tokens"),
    estimatedUsd: rowNullableNumber(row, "estimated_usd"),
    startedAt: rowString(row, "started_at"),
    completedAt: rowNullableString(row, "completed_at"),
    errorCode: rowNullableString(row, "error_code"),
    output: rowNullableJson(row, "output_json"),
    payload: parse(rowString(row, "payload_json")),
    checksum: rowString(row, "record_checksum"),
  };
}

export function findingFromRow(row: Record<string, unknown>): FindingRecord {
  return {
    id: rowString(row, "id"),
    workspaceId: rowString(row, "workspace_id"),
    runId: rowString(row, "run_id"),
    roundId: rowString(row, "round_id"),
    executionId: rowNullableString(row, "execution_id"),
    artifactId: rowNullableString(row, "artifact_id"),
    code: rowString(row, "code"),
    category: rowString(row, "category"),
    severity: rowString(row, "severity") as StoredFindingSeverity,
    message: rowString(row, "message"),
    claimId: rowNullableString(row, "claim_id"),
    sectionId: rowNullableString(row, "section_id"),
    requirementId: rowNullableString(row, "requirement_id"),
    createdAt: rowString(row, "created_at"),
    payload: parse(rowString(row, "payload_json")),
    checksum: rowString(row, "record_checksum"),
  };
}

export function decisionFromRow(row: Record<string, unknown>): DecisionRecord {
  return {
    id: rowString(row, "id"),
    workspaceId: rowString(row, "workspace_id"),
    runId: rowString(row, "run_id"),
    roundId: rowNullableString(row, "round_id"),
    artifactId: rowNullableString(row, "artifact_id"),
    type: rowString(row, "type") as StoredDecisionType,
    rationale: rowString(row, "rationale"),
    actor: rowString(row, "actor"),
    createdAt: rowString(row, "created_at"),
    payload: parse(rowString(row, "payload_json")),
    checksum: rowString(row, "record_checksum"),
  };
}

export function exportFromRow(row: Record<string, unknown>): ExportRecord {
  return {
    id: rowString(row, "id"),
    workspaceId: rowString(row, "workspace_id"),
    runId: rowString(row, "run_id"),
    artifactId: rowString(row, "artifact_id"),
    format: rowString(row, "format"),
    status: rowString(row, "status") as StoredExportStatus,
    outputPath: rowNullableString(row, "output_path"),
    outputChecksum: rowNullableString(row, "output_checksum"),
    createdAt: rowString(row, "created_at"),
    payload: parse(rowString(row, "payload_json")),
    checksum: rowString(row, "record_checksum"),
  };
}

/** Validates a run and returns it with its record checksum. */
export function prepareRunRecord(input: RunRecordInput): RunRecord {
  requireNonEmpty(input.id, "run id");
  requireNonEmpty(input.workspaceId, "run workspaceId");
  requireNonEmpty(input.contextSnapshotId, "run contextSnapshotId");
  requireStoredRunState(input.state, "run state");
  requirePositive(input.round, "run round");
  requireStoredStep(input.currentStep, "run currentStep");
  requireNonEmpty(input.startedAt, "run startedAt");
  requireNonEmpty(input.updatedAt, "run updatedAt");
  requireNonNegativeNumber(input.totalCostUsd, "run totalCostUsd");
  assertSafeRecordFields(input, ["budget", "lastError", "payload"]);
  return { ...input, checksum: recordChecksum(input) };
}

export function runAuditEvent(record: RunRecord): AuditEventInput {
  return {
    id: `run:${record.id}:${record.checksum}`,
    workspaceId: record.workspaceId,
    eventType: "run.appended",
    entityType: "run",
    entityId: record.id,
    payload: recordToJson(record),
    createdAt: record.updatedAt,
  };
}

/** Validates a run snapshot and returns its content-addressed id and record checksum. */
export function prepareRunSnapshot(input: RunSnapshotRecordInput): {
  readonly id: string;
  readonly checksum: string;
} {
  requireNonEmpty(input.workspaceId, "run snapshot workspaceId");
  requireNonEmpty(input.runId, "run snapshot runId");
  requireNonEmpty(input.contextSnapshotId, "run snapshot contextSnapshotId");
  requireStoredRunState(input.state, "run snapshot state");
  requirePositive(input.round, "run snapshot round");
  requireStoredStep(input.currentStep, "run snapshot currentStep");
  requireNonEmpty(input.startedAt, "run snapshot startedAt");
  requireNonEmpty(input.updatedAt, "run snapshot updatedAt");
  requireNonNegativeNumber(input.totalCostUsd, "run snapshot totalCostUsd");
  assertSafeRecordFields(input, ["budget", "lastError", "payload"]);
  const checksumValue = recordChecksum(input);
  return { id: `run-snapshot:${input.runId}:${checksumValue}`, checksum: checksumValue };
}

export function prepareRoundRecord(input: RoundRecordInput): RoundRecord {
  requireNonEmpty(input.id, "round id");
  requireNonEmpty(input.workspaceId, "round workspaceId");
  requireNonEmpty(input.runId, "round runId");
  requirePositive(input.number, "round number");
  requireStoredRunState(input.state, "round state");
  requireNonEmpty(input.startedAt, "round startedAt");
  if (input.completedAt !== null) requireNonEmpty(input.completedAt, "round completedAt");
  assertSafeRecordFields(input, ["evaluation", "payload"]);
  return { ...input, checksum: recordChecksum(input) };
}

export function roundAuditEvent(record: RoundRecord): AuditEventInput {
  return {
    id: `round:${record.id}:${record.checksum}`,
    workspaceId: record.workspaceId,
    eventType: "round.appended",
    entityType: "round",
    entityId: record.id,
    payload: recordToJson(record),
    createdAt: record.startedAt,
  };
}

export function prepareExecutionRecord(input: ExecutionRecordInput): ExecutionRecord {
  requireNonEmpty(input.id, "execution id");
  requireNonEmpty(input.workspaceId, "execution workspaceId");
  requireNonEmpty(input.runId, "execution runId");
  requireNonEmpty(input.roundId, "execution roundId");
  requireNonEmpty(input.contextSnapshotId, "execution contextSnapshotId");
  requirePositive(input.attempt, "execution attempt");
  requireNonEmpty(input.provider, "execution provider");
  requireNonEmpty(input.modelId, "execution modelId");
  requireNonNegativeInteger(input.inputTokens, "execution inputTokens");
  requireNonNegativeInteger(input.outputTokens, "execution outputTokens");
  requireNonNegativeInteger(input.totalTokens, "execution totalTokens");
  if (input.estimatedUsd !== null)
    requireNonNegativeNumber(input.estimatedUsd, "execution estimatedUsd");
  requireNonEmpty(input.startedAt, "execution startedAt");
  if (input.completedAt !== null) requireNonEmpty(input.completedAt, "execution completedAt");
  assertSafeRecordFields(input, ["output", "payload"]);
  return { ...input, checksum: recordChecksum(input) };
}

export function executionAuditEvent(record: ExecutionRecord): AuditEventInput {
  return {
    id: `execution:${record.id}:${record.checksum}`,
    workspaceId: record.workspaceId,
    eventType: "execution.appended",
    entityType: "execution",
    entityId: record.id,
    payload: recordToJson(record),
    createdAt: record.completedAt ?? record.startedAt,
  };
}

export function prepareFindingRecord(input: FindingRecordInput): FindingRecord {
  requireNonEmpty(input.id, "finding id");
  requireNonEmpty(input.workspaceId, "finding workspaceId");
  requireNonEmpty(input.runId, "finding runId");
  requireNonEmpty(input.roundId, "finding roundId");
  requireNonEmpty(input.code, "finding code");
  requireNonEmpty(input.category, "finding category");
  requireNonEmpty(input.message, "finding message");
  requireNonEmpty(input.createdAt, "finding createdAt");
  assertSafeRecordFields(input, ["payload"]);
  return { ...input, checksum: recordChecksum(input) };
}

export function findingAuditEvent(record: FindingRecord): AuditEventInput {
  return {
    id: `finding:${record.id}:${record.checksum}`,
    workspaceId: record.workspaceId,
    eventType: "finding.appended",
    entityType: "finding",
    entityId: record.id,
    payload: recordToJson(record),
    createdAt: record.createdAt,
  };
}

export function prepareDecisionRecord(input: DecisionRecordInput): DecisionRecord {
  requireNonEmpty(input.id, "decision id");
  requireNonEmpty(input.workspaceId, "decision workspaceId");
  requireNonEmpty(input.runId, "decision runId");
  requireNonEmpty(input.rationale, "decision rationale");
  requireNonEmpty(input.actor, "decision actor");
  requireNonEmpty(input.createdAt, "decision createdAt");
  assertSafeRecordFields(input, ["payload"]);
  return { ...input, checksum: recordChecksum(input) };
}

export function decisionAuditEvent(record: DecisionRecord): AuditEventInput {
  return {
    id: `decision:${record.id}:${record.checksum}`,
    workspaceId: record.workspaceId,
    eventType: "decision.appended",
    entityType: "decision",
    entityId: record.id,
    payload: recordToJson(record),
    createdAt: record.createdAt,
  };
}

export function prepareExportRecord(input: ExportRecordInput): ExportRecord {
  requireNonEmpty(input.id, "export id");
  requireNonEmpty(input.workspaceId, "export workspaceId");
  requireNonEmpty(input.runId, "export runId");
  requireNonEmpty(input.artifactId, "export artifactId");
  requireNonEmpty(input.format, "export format");
  requireNonEmpty(input.createdAt, "export createdAt");
  assertSafeRecordFields(input, ["payload"]);
  return { ...input, checksum: recordChecksum(input) };
}

export function exportAuditEvent(record: ExportRecord): AuditEventInput {
  return {
    id: `export:${record.id}:${record.checksum}`,
    workspaceId: record.workspaceId,
    eventType: "export.appended",
    entityType: "export",
    entityId: record.id,
    payload: recordToJson(record),
    createdAt: record.createdAt,
  };
}
