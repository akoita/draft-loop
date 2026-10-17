import type { WorkflowState } from "@draft-loop/domain";

export interface StoragePort {
  readonly get: (key: string) => Promise<string | undefined>;
  readonly set: (key: string, value: string) => Promise<void>;
}

export interface WorkspaceBackupResult {
  readonly backupPath: string;
  readonly checksum: string;
  readonly sizeBytes: number;
  readonly createdAt: string;
}

export interface WorkspaceRestoreOptions {
  readonly verifyIntegrity?: boolean;
}

export interface MigrationReport {
  readonly appliedCount: number;
  readonly appliedVersions: readonly number[];
  readonly latestVersion: number;
}

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface WorkspaceRecord {
  readonly id: string;
  readonly state: WorkflowState;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DiagnosticTelemetryReport {
  readonly generatedAt: string;
  readonly schemaVersion: 1;
  readonly aggregates: {
    readonly workspacesCount: number;
    readonly totalRunsCount: number;
    readonly totalRoundsCount: number;
    readonly totalExecutionsCount: number;
    readonly executionsByStatus: Readonly<Record<string, number>>;
    readonly executionsByStep: Readonly<Record<string, number>>;
    readonly findingsCount: number;
    readonly findingsBySeverity: Readonly<Record<string, number>>;
    readonly decisionsCount: number;
    readonly totalCostUsd: number;
    readonly totalTokens: {
      readonly inputTokens: number;
      readonly outputTokens: number;
      readonly totalTokens: number;
    };
    readonly providersDistribution: Readonly<Record<string, number>>;
  };
  readonly checksum: string;
}

/** Workspace records, the root every other record belongs to. */
export interface WorkspaceStoragePort {
  readonly saveWorkspace: (record: WorkspaceRecord) => Promise<void>;
  readonly getWorkspace: (id: string) => Promise<WorkspaceRecord | undefined>;
}

/** A store its caller opened and must release once done. */
export interface ClosableStoragePort {
  readonly close: () => Promise<void>;
}
