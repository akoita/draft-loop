export class WorkerConfigError extends Error {
  override readonly name = "WorkerConfigError";
}

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
  /** Touched once the worker is claiming jobs, for a container health check. */
  readonly readyFile?: string;
}

export interface MigrationConfig {
  /** The schema owner's connection, used only by the migration job. */
  readonly databaseUrl: string;
  readonly databaseSchema: string;
  readonly queueSchema: string;
  /** The role the API and the worker connect as, granted table access only. */
  readonly runtimeRole: string;
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
  return {
    databaseUrl: required(env, "DRAFT_LOOP_DATABASE_URL"),
    databaseSchema: schemaName(env, "DRAFT_LOOP_DATABASE_SCHEMA", "draft_loop"),
    queueSchema: schemaName(env, "DRAFT_LOOP_QUEUE_SCHEMA", "draft_loop_queue"),
    tenantId,
    blobBucket: required(env, "DRAFT_LOOP_BLOB_BUCKET"),
    ...(gcsEndpoint === undefined ? {} : { gcsEndpoint }),
    allowProviderData: allow === "true",
    ...(readyFile === undefined ? {} : { readyFile }),
  };
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
  };
}
