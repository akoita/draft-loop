import { type RunBudgetCeiling, readRunBudgetCeiling } from "@draft-loop/application";
import { parseRuntimeRoleMembers } from "@draft-loop/storage-postgres";

import { WorkerConfigError } from "./config-error.js";
import { type ModelGatewayConfig, readModelGatewayConfig } from "./model-routes.js";

export { WorkerConfigError } from "./config-error.js";

export interface WorkerConfig {
  /** The runtime role's connection: no superuser and no `BYPASSRLS`, so row-level security holds. */
  readonly databaseUrl: string;
  readonly databaseSchema: string;
  readonly queueSchema: string;
  /** Phase 1 serves one tenant per deployment (ADR 0011); a job for another tenant fails. */
  readonly tenantId: string;
  readonly blobBucket: string;
  /** A Cloud Storage emulator, for the local stack only; unset in a deployment. */
  readonly gcsEndpoint?: string;
  /** Whether runs may send approved material to providers; off unless the deployment says so. */
  readonly allowProviderData: boolean;
  /** The deployment's limit per run, re-checked before each run executes. */
  readonly budgetCeiling: RunBudgetCeiling;
  /** The model routes; absent on the local stack, where runs use fixtures and call no provider. */
  readonly modelGateway?: ModelGatewayConfig;
  /** Touched once the worker is claiming jobs, for a container health check. */
  readonly readyFile?: string;
  /**
   * `serve` keeps claiming until it is stopped (the local stack); `drain` stops once the queue has
   * had no job for `idleMs`, for a worker that runs as a Cloud Run job.
   */
  readonly mode: { readonly kind: "serve" } | { readonly kind: "drain"; readonly idleMs: number };
}

export interface MigrationConfig {
  /** The schema owner's connection, used only by the migration job. */
  readonly databaseUrl: string;
  readonly databaseSchema: string;
  readonly queueSchema: string;
  /** The role the API and the worker connect as, granted table access only. */
  readonly runtimeRole: string;
  /** The IAM database users made members of the runtime role on Cloud SQL; none locally. */
  readonly runtimeMembers: readonly string[];
}

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const schemaPattern = /^[a-z_][a-z0-9_]{0,62}$/u;

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name] ?? "";
  if (value === "") throw new WorkerConfigError(`${name} is required.`);
  return value;
}

function schemaName(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  const value = env[name] ?? fallback;
  if (!schemaPattern.test(value)) throw new WorkerConfigError(`${name} must be a schema name.`);
  return value;
}

function optional(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name] ?? "";
  return value === "" ? undefined : value;
}

/**
 * Reads the worker's settings. Connection strings come from the deployment's secrets and bucket
 * names from its infrastructure, never from this repository.
 */
export function readWorkerConfig(env: NodeJS.ProcessEnv): WorkerConfig {
  const tenantId = required(env, "DRAFT_LOOP_TENANT_ID");
  if (!identifierPattern.test(tenantId)) {
    throw new WorkerConfigError("DRAFT_LOOP_TENANT_ID must be a safe identifier.");
  }
  const allow = env.DRAFT_LOOP_ALLOW_PROVIDER_DATA ?? "false";
  if (allow !== "true" && allow !== "false") {
    throw new WorkerConfigError("DRAFT_LOOP_ALLOW_PROVIDER_DATA must be true or false.");
  }
  const gcsEndpoint = optional(env, "DRAFT_LOOP_GCS_ENDPOINT");
  const readyFile = optional(env, "DRAFT_LOOP_WORKER_READY_FILE");
  const modelGateway = readModelGatewayConfig(env);
  return {
    databaseUrl: required(env, "DRAFT_LOOP_DATABASE_URL"),
    databaseSchema: schemaName(env, "DRAFT_LOOP_DATABASE_SCHEMA", "draft_loop"),
    queueSchema: schemaName(env, "DRAFT_LOOP_QUEUE_SCHEMA", "draft_loop_queue"),
    tenantId,
    blobBucket: required(env, "DRAFT_LOOP_BLOB_BUCKET"),
    ...(gcsEndpoint === undefined ? {} : { gcsEndpoint }),
    allowProviderData: allow === "true",
    budgetCeiling: readRunBudgetCeiling(env),
    ...(modelGateway === undefined ? {} : { modelGateway }),
    ...(readyFile === undefined ? {} : { readyFile }),
    mode: workerMode(env),
  };
}

const idleMsRange = { min: 1_000, max: 3_600_000, fallback: 60_000 };

function workerMode(env: NodeJS.ProcessEnv): WorkerConfig["mode"] {
  const kind = env.DRAFT_LOOP_WORKER_MODE ?? "serve";
  if (kind === "serve") return { kind };
  if (kind !== "drain")
    throw new WorkerConfigError("DRAFT_LOOP_WORKER_MODE must be serve or drain.");
  const raw = env.DRAFT_LOOP_WORKER_IDLE_MS ?? "";
  const idleMs = raw === "" ? idleMsRange.fallback : Number(raw);
  if (!Number.isInteger(idleMs) || idleMs < idleMsRange.min || idleMs > idleMsRange.max) {
    throw new WorkerConfigError(
      "DRAFT_LOOP_WORKER_IDLE_MS must be a whole number of milliseconds from 1000 to 3600000.",
    );
  }
  return { kind, idleMs };
}

function runtimeMembers(env: NodeJS.ProcessEnv): readonly string[] {
  try {
    return parseRuntimeRoleMembers(env.DRAFT_LOOP_RUNTIME_MEMBERS);
  } catch {
    throw new WorkerConfigError(
      "DRAFT_LOOP_RUNTIME_MEMBERS must list IAM database users, name@project.iam, separated by commas.",
    );
  }
}

/** Reads the migration job's settings: the owner's connection and the runtime role to grant. */
export function readMigrationConfig(env: NodeJS.ProcessEnv): MigrationConfig {
  const runtimeRole = required(env, "DRAFT_LOOP_RUNTIME_ROLE");
  if (!schemaPattern.test(runtimeRole)) {
    throw new WorkerConfigError("DRAFT_LOOP_RUNTIME_ROLE must be a role name.");
  }
  return {
    databaseUrl: required(env, "DRAFT_LOOP_MIGRATION_DATABASE_URL"),
    databaseSchema: schemaName(env, "DRAFT_LOOP_DATABASE_SCHEMA", "draft_loop"),
    queueSchema: schemaName(env, "DRAFT_LOOP_QUEUE_SCHEMA", "draft_loop_queue"),
    runtimeRole,
    runtimeMembers: runtimeMembers(env),
  };
}
