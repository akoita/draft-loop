import type { WorkflowState } from "@draft-loop/domain";
import type { ArtifactVersionInput, ArtifactVersionRecord } from "../artifact-history.js";
import type { AuditEventReadsPort } from "../audit-event-reads.js";
import type { JsonValue } from "./workspace.js";

export type StoredRunState = WorkflowState | "provider-error";
export type StoredRunStep = "author" | "critic" | "revision" | null;
export type StoredApprovalStatus = "pending" | "approved" | "rejected";
export type StoredRoundState = Extract<
  StoredRunState,
  | "drafting"
  | "reviewing"
  | "revising"
  | "budget-exhausted"
  | "provider-error"
  | "paused"
  | "stopped"
  | "awaiting-approval"
>;
export type StoredExecutionStep = Exclude<StoredRunStep, null>;
export type StoredExecutionStatus = "completed" | "failed";
export type StoredFindingSeverity = "error" | "warning";
export type StoredDecisionType = "edit" | "accept-finding" | "reject-finding" | "approve";
export type StoredExportStatus = "prepared" | "completed" | "failed";

export interface RunRecordInput {
  readonly id: string;
  readonly workspaceId: string;
  readonly contextSnapshotId: string;
  readonly state: StoredRunState;
  readonly round: number;
  readonly currentStep: StoredRunStep;
  readonly budget: JsonValue;
  readonly artifactId: string | null;
  readonly approval: StoredApprovalStatus;
  readonly totalCostUsd: number;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly lastError: JsonValue | null;
  readonly payload: JsonValue;
}

export interface RunRecord extends RunRecordInput {
  readonly checksum: string;
}

/**
 * Append-only lifecycle projection input. The full orchestration snapshot is
 * retained in `payload`; the duplicated columns keep current-state queries
 * cheap and independent of the orchestrator package.
 */
export interface RunSnapshotRecordInput {
  readonly workspaceId: string;
  readonly runId: string;
  readonly contextSnapshotId: string;
  readonly state: StoredRunState;
  readonly round: number;
  readonly currentStep: StoredRunStep;
  readonly budget: JsonValue;
  readonly artifactId: string | null;
  readonly approval: StoredApprovalStatus;
  readonly totalCostUsd: number;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly lastError: JsonValue | null;
  readonly payload: JsonValue;
}

export interface RunSnapshotRecord extends RunSnapshotRecordInput {
  readonly id: string;
  readonly sequence: number;
  readonly checksum: string;
}

export interface RoundRecordInput {
  readonly id: string;
  readonly workspaceId: string;
  readonly runId: string;
  readonly number: number;
  readonly state: StoredRoundState;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly evaluation: JsonValue | null;
  readonly payload: JsonValue;
}

export interface RoundRecord extends RoundRecordInput {
  readonly checksum: string;
}

export interface ExecutionRecordInput {
  readonly id: string;
  readonly workspaceId: string;
  readonly runId: string;
  readonly roundId: string;
  readonly contextSnapshotId: string;
  readonly artifactId: string | null;
  readonly attempt: number;
  readonly step: StoredExecutionStep;
  readonly status: StoredExecutionStatus;
  readonly provider: string;
  readonly modelId: string;
  readonly providerRequestId: string | null;
  readonly outputChecksum: string | null;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly estimatedUsd: number | null;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly errorCode: string | null;
  readonly output: JsonValue | null;
  readonly payload: JsonValue;
}

export interface ExecutionRecord extends ExecutionRecordInput {
  readonly checksum: string;
}

export interface FindingRecordInput {
  readonly id: string;
  readonly workspaceId: string;
  readonly runId: string;
  readonly roundId: string;
  readonly executionId: string | null;
  readonly artifactId: string | null;
  readonly code: string;
  readonly category: string;
  readonly severity: StoredFindingSeverity;
  readonly message: string;
  readonly claimId: string | null;
  readonly sectionId: string | null;
  readonly requirementId: string | null;
  readonly createdAt: string;
  readonly payload: JsonValue;
}

export interface FindingRecord extends FindingRecordInput {
  readonly checksum: string;
}

export interface DecisionRecordInput {
  readonly id: string;
  readonly workspaceId: string;
  readonly runId: string;
  readonly roundId: string | null;
  readonly artifactId: string | null;
  readonly type: StoredDecisionType;
  readonly rationale: string;
  readonly actor: string;
  readonly createdAt: string;
  readonly payload: JsonValue;
}

export interface DecisionRecord extends DecisionRecordInput {
  readonly checksum: string;
}

export interface ExportRecordInput {
  readonly id: string;
  readonly workspaceId: string;
  readonly runId: string;
  readonly artifactId: string;
  readonly format: string;
  readonly status: StoredExportStatus;
  readonly outputPath: string | null;
  readonly outputChecksum: string | null;
  readonly createdAt: string;
  readonly payload: JsonValue;
}

export interface ExportRecord extends ExportRecordInput {
  readonly checksum: string;
}

export interface RetentionPlan {
  readonly before: string;
  readonly auditEventsEligible: number;
  readonly immutableBusinessRecords: true;
}

export interface RetentionPurgeOptions {
  readonly confirmed: boolean;
}

export interface RetentionPurgeResult {
  readonly before: string;
  readonly deletedAuditEventsCount: number;
  readonly executedAt: string;
}

/** Typed history boundary shared by CLI and future UI adapters. */
export interface HistoryStoragePort {
  readonly saveRun: (input: RunRecordInput) => Promise<RunRecord>;
  readonly getRun: (id: string) => Promise<RunRecord | undefined>;
  readonly listRuns: (workspaceId: string) => Promise<readonly RunRecord[]>;
  readonly saveRunSnapshot: (input: RunSnapshotRecordInput) => Promise<RunSnapshotRecord>;
  readonly getLatestRunSnapshot: (runId: string) => Promise<RunSnapshotRecord | undefined>;
  readonly listRunSnapshots: (runId: string) => Promise<readonly RunSnapshotRecord[]>;
  readonly saveRound: (input: RoundRecordInput) => Promise<RoundRecord>;
  readonly getRound: (id: string) => Promise<RoundRecord | undefined>;
  readonly listRounds: (runId: string) => Promise<readonly RoundRecord[]>;
  readonly saveExecution: (input: ExecutionRecordInput) => Promise<ExecutionRecord>;
  readonly getExecution: (id: string) => Promise<ExecutionRecord | undefined>;
  readonly listExecutions: (runId: string) => Promise<readonly ExecutionRecord[]>;
  readonly saveFinding: (input: FindingRecordInput) => Promise<FindingRecord>;
  readonly getFinding: (id: string) => Promise<FindingRecord | undefined>;
  readonly listFindings: (runId: string) => Promise<readonly FindingRecord[]>;
  readonly saveDecision: (input: DecisionRecordInput) => Promise<DecisionRecord>;
  readonly getDecision: (id: string) => Promise<DecisionRecord | undefined>;
  readonly listDecisions: (runId: string) => Promise<readonly DecisionRecord[]>;
  readonly saveExport: (input: ExportRecordInput) => Promise<ExportRecord>;
  readonly getExport: (id: string) => Promise<ExportRecord | undefined>;
  readonly listExports: (runId: string) => Promise<readonly ExportRecord[]>;
}

export interface AuditEventInput {
  readonly id: string;
  readonly workspaceId: string;
  readonly eventType: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly payload: JsonValue;
  readonly createdAt: string;
}

export interface AuditEvent extends AuditEventInput {
  readonly sequence: number;
  readonly payloadChecksum: string;
  readonly previousEventChecksum: string | null;
  readonly eventChecksum: string;
}

/** Immutable artifact versions that runs, executions and exports point at. */
export interface ArtifactHistoryStoragePort {
  readonly saveArtifactVersion: (input: ArtifactVersionInput) => Promise<ArtifactVersionRecord>;
  readonly getArtifactVersion: (id: string) => Promise<ArtifactVersionRecord | undefined>;
}

/** The per-workspace, hash-chained audit trail. */
export interface AuditTrailStoragePort {
  readonly appendAuditEvent: (input: AuditEventInput) => Promise<AuditEvent>;
  readonly listAuditEvents: (workspaceId: string) => Promise<readonly AuditEvent[]>;
  readonly auditEvents: AuditEventReadsPort;
}
