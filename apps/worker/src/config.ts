import {
  type DeploymentAuthMode,
  DeploymentAuthModeConfigError,
  type RunBudgetCeiling,
  readDeploymentAuthMode,
  readRunBudgetCeiling,
} from "@draft-loop/application";
import { parseRuntimeRoleMembers } from "@draft-loop/storage-postgres";

import { WorkerConfigError } from "./config-error.js";
import { type ModelGatewayConfig, readModelGatewayConfig } from "./model-routes.js";

export { WorkerConfigError } from "./config-error.js";

export interface WorkerConfig {
  /** The runtime role's connection: no superuser and no `BYPASSRLS`, so row-level security holds. */
  readonly databaseUrl: string;
  readonly databaseSchema: string;
  readonly queueSchema: string;
  readonly blobBucket: string;
  /** A Cloud Storage emulator, for the local stack only; unset in a deployment. */
  readonly gcsEndpoint?: string;
  /** Whether runs may send approved material to providers; off unless the deployment says so. */
  readonly allowProviderData: boolean;
  /**
   * Whether each job needs its candidate record's current provider transmission consent;
   * `allowProviderData` stays a ceiling above it. Always on when `DRAFT_LOOP_AUTH_MODE` is `oidc`;
   * in owner mode, off unless `DRAFT_LOOP_REQUIRE_CONSENT` says so.
   */
  readonly requireConsent: boolean;
  /**
   * Whether a missing screening result counts against a job's material (#1677). The same
   * `DRAFT_LOOP_SCREENING` the API reads: on unless it is `off`, so a job whose brief or knowledge
   * source has no stored result is held, never run as clear. The mode only decides this; the
   * worker screens nothing.
   */
  readonly requireScreening: boolean;
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

function flag(env: NodeJS.ProcessEnv, name: string): boolean {
  const value = env[name] ?? "false";
  if (value !== "true" && value !== "false") {
    throw new WorkerConfigError(`${name} must be true or false.`);
  }
  return value === "true";
}

function authMode(env: NodeJS.ProcessEnv): DeploymentAuthMode {
  try {
    return readDeploymentAuthMode(env);
  } catch (error) {
    if (error instanceof DeploymentAuthModeConfigError) throw new WorkerConfigError(error.message);
    throw error;
  }
}

/**
 * A sign-in deployment always checks consent, so a worker setting cannot switch the check off: an
 * explicit `false` beside `oidc` is refused at startup rather than ignored. In owner mode the
 * setting keeps its meaning, off by default, because the local stack's one worker also serves its
 * owner-mode API, whose runs carry no consent.
 */
function consentRequired(env: NodeJS.ProcessEnv): boolean {
  const name = "DRAFT_LOOP_REQUIRE_CONSENT";
  const explicit = env[name] === undefined ? undefined : flag(env, name);
  if (authMode(env) !== "oidc") return explicit ?? false;
  if (explicit === false) {
    throw new WorkerConfigError(
      `${name}=false is not allowed when DRAFT_LOOP_AUTH_MODE is oidc; remove it, as a sign-in deployment always checks consent.`,
    );
  }
  return true;
}

const screeningModes = ["off", "rules", "rules+model"];

/** Screening is on unless `DRAFT_LOOP_SCREENING` is `off`; an unknown value is a startup error. */
function screeningRequired(env: NodeJS.ProcessEnv): boolean {
  const value = env.DRAFT_LOOP_SCREENING ?? "";
  if (value !== "" && !screeningModes.includes(value)) {
    throw new WorkerConfigError(
      `DRAFT_LOOP_SCREENING must be one of ${screeningModes.join(", ")}.`,
    );
  }
  return value !== "off";
}

function optional(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name] ?? "";
  return value === "" ? undefined : value;
}

/**
 * Reads the worker's settings. Connection strings come from the deployment's secrets and bucket
 * names from its infrastructure, never from this repository. The worker serves every tenant, each
 * job naming its own, so it reads no tenant: `DRAFT_LOOP_TENANT_ID`, which the API still takes, is
 * ignored here.
 */
export function readWorkerConfig(env: NodeJS.ProcessEnv): WorkerConfig {
  const allow = flag(env, "DRAFT_LOOP_ALLOW_PROVIDER_DATA");
  const requireConsent = consentRequired(env);
  const gcsEndpoint = optional(env, "DRAFT_LOOP_GCS_ENDPOINT");
  const readyFile = optional(env, "DRAFT_LOOP_WORKER_READY_FILE");
  const modelGateway = readModelGatewayConfig(env);
  return {
    databaseUrl: required(env, "DRAFT_LOOP_DATABASE_URL"),
    databaseSchema: schemaName(env, "DRAFT_LOOP_DATABASE_SCHEMA", "draft_loop"),
    queueSchema: schemaName(env, "DRAFT_LOOP_QUEUE_SCHEMA", "draft_loop_queue"),
    blobBucket: required(env, "DRAFT_LOOP_BLOB_BUCKET"),
    ...(gcsEndpoint === undefined ? {} : { gcsEndpoint }),
    allowProviderData: allow,
    requireConsent,
    requireScreening: screeningRequired(env),
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
