import { ownerTokenMinimumLength } from "./owner-access.js";
import { isCloudRunJobName } from "./worker-wake.js";

export interface ApiConfig {
  readonly host: string;
  readonly port: number;
  readonly ownerToken: string;
  /** The worker's Cloud Run job, started after each queued run; unset on the local stack. */
  readonly workerJob?: string;
}

export class ApiConfigError extends Error {
  override readonly name = "ApiConfigError";
}

/**
 * Reads the API's settings from the environment. `PORT` is what Cloud Run sets; the owner token
 * comes from the deployment's secret, never from this repository.
 */
export function readApiConfig(env: NodeJS.ProcessEnv): ApiConfig {
  const ownerToken = env.DRAFT_LOOP_API_OWNER_TOKEN ?? "";
  if (ownerToken.length < ownerTokenMinimumLength || /\s/u.test(ownerToken)) {
    throw new ApiConfigError(
      `DRAFT_LOOP_API_OWNER_TOKEN must be at least ${ownerTokenMinimumLength} characters with no whitespace.`,
    );
  }
  const portText = env.PORT ?? "8080";
  const port = Number(portText);
  if (!/^\d+$/u.test(portText) || port < 1 || port > 65_535) {
    throw new ApiConfigError("PORT must be a TCP port number.");
  }
  const workerJob = env.DRAFT_LOOP_WORKER_JOB ?? "";
  if (workerJob !== "" && !isCloudRunJobName(workerJob)) {
    throw new ApiConfigError(
      "DRAFT_LOOP_WORKER_JOB must be a Cloud Run job name, projects/<project>/locations/<region>/jobs/<job>.",
    );
  }
  return {
    host: env.DRAFT_LOOP_API_HOST ?? "0.0.0.0",
    port,
    ownerToken,
    ...(workerJob === "" ? {} : { workerJob }),
  };
}

export interface HostedStorageConfig {
  /** The runtime role's connection: no superuser and no `BYPASSRLS`, so row-level security holds. */
  readonly databaseUrl: string;
  readonly databaseSchema: string;
  readonly queueSchema: string;
  /** Phase 1 serves one tenant per deployment (ADR 0011). */
  readonly tenantId: string;
  readonly blobBucket: string;
  /** A Cloud Storage emulator, for the local stack only; unset in a deployment. */
  readonly gcsEndpoint?: string;
  /** The largest candidate source file the API takes; intake's default when unset. */
  readonly maxSourceBytes?: number;
}

/** Cloud Run refuses requests over 32 MiB, so a larger limit could never be reached. */
const maximumSourceBytesLimit = 30 * 1024 * 1024;

function optionalSourceLimit(env: NodeJS.ProcessEnv): number | undefined {
  const text = env.DRAFT_LOOP_MAX_SOURCE_BYTES ?? "";
  if (text === "") return undefined;
  const value = Number(text);
  if (!Number.isInteger(value) || value < 1 || value > maximumSourceBytesLimit) {
    throw new ApiConfigError(
      `DRAFT_LOOP_MAX_SOURCE_BYTES must be a whole number of bytes from 1 to ${maximumSourceBytesLimit}.`,
    );
  }
  return value;
}

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const schemaPattern = /^[a-z_][a-z0-9_]{0,62}$/u;

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name] ?? "";
  if (value === "") throw new ApiConfigError(`${name} is required.`);
  return value;
}

function schemaName(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  const value = env[name] ?? fallback;
  if (!schemaPattern.test(value)) throw new ApiConfigError(`${name} must be a schema name.`);
  return value;
}

/**
 * Reads where the hosted service keeps its data. Connection strings come from the deployment's
 * secrets and bucket names from its infrastructure, never from this repository.
 */
export function readHostedStorageConfig(env: NodeJS.ProcessEnv): HostedStorageConfig {
  const tenantId = required(env, "DRAFT_LOOP_TENANT_ID");
  if (!identifierPattern.test(tenantId)) {
    throw new ApiConfigError("DRAFT_LOOP_TENANT_ID must be a safe identifier.");
  }
  const gcsEndpoint = env.DRAFT_LOOP_GCS_ENDPOINT ?? "";
  const maxSourceBytes = optionalSourceLimit(env);
  return {
    databaseUrl: required(env, "DRAFT_LOOP_DATABASE_URL"),
    databaseSchema: schemaName(env, "DRAFT_LOOP_DATABASE_SCHEMA", "draft_loop"),
    queueSchema: schemaName(env, "DRAFT_LOOP_QUEUE_SCHEMA", "draft_loop_queue"),
    tenantId,
    blobBucket: required(env, "DRAFT_LOOP_BLOB_BUCKET"),
    ...(gcsEndpoint === "" ? {} : { gcsEndpoint }),
    ...(maxSourceBytes === undefined ? {} : { maxSourceBytes }),
  };
}
