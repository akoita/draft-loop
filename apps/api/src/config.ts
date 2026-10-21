import { ownerTokenMinimumLength } from "./owner-access.js";

export interface ApiConfig {
  readonly host: string;
  readonly port: number;
  readonly ownerToken: string;
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
  return { host: env.DRAFT_LOOP_API_HOST ?? "0.0.0.0", port, ownerToken };
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
  return {
    databaseUrl: required(env, "DRAFT_LOOP_DATABASE_URL"),
    databaseSchema: schemaName(env, "DRAFT_LOOP_DATABASE_SCHEMA", "draft_loop"),
    queueSchema: schemaName(env, "DRAFT_LOOP_QUEUE_SCHEMA", "draft_loop_queue"),
    tenantId,
    blobBucket: required(env, "DRAFT_LOOP_BLOB_BUCKET"),
    ...(gcsEndpoint === "" ? {} : { gcsEndpoint }),
  };
}
