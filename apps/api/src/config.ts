import { isAbsolute } from "node:path";
import {
  type DeploymentAuthMode,
  DeploymentAuthModeConfigError,
  readDeploymentAuthMode,
} from "@draft-loop/application";
import { type BlobBackendConfig, readBlobBackend } from "./blob-backend.js";
import { isProviderUrl, type OidcSettings } from "./oidc-sign-in.js";
import { ownerTokenMinimumLength } from "./owner-access.js";
import { isCloudRunJobName } from "./worker-wake.js";

/** How the API authenticates requests: the owner token alone, or sign-in through the provider. */
export type ApiAuthConfig = { readonly mode: "owner" } | (OidcSettings & { readonly mode: "oidc" });

export interface ApiConfig {
  readonly host: string;
  readonly port: number;
  /** Every request's credential in owner mode; the operator's credential in sign-in mode. */
  readonly ownerToken: string;
  readonly auth: ApiAuthConfig;
  /** The worker's Cloud Run job, started after each queued run; unset on the local stack. */
  readonly workerJob?: string;
  /** The built web screen's directory, served at `/`; the image sets it. */
  readonly webRoot?: string;
  /** The separate page fetcher job pages are fetched through; the API fetches them itself when unset. */
  readonly pageFetcherUrl?: string;
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
  const webRoot = env.DRAFT_LOOP_WEB_ROOT ?? "";
  if (webRoot !== "" && !isAbsolute(webRoot)) {
    throw new ApiConfigError("DRAFT_LOOP_WEB_ROOT must be an absolute directory path.");
  }
  const pageFetcherUrl = env.DRAFT_LOOP_PAGE_FETCHER_URL ?? "";
  if (pageFetcherUrl !== "" && !isServiceOrigin(pageFetcherUrl)) {
    throw new ApiConfigError(
      "DRAFT_LOOP_PAGE_FETCHER_URL must be an http or https origin, with no path, query or credentials.",
    );
  }
  return {
    host: env.DRAFT_LOOP_API_HOST ?? "0.0.0.0",
    port,
    ownerToken,
    auth: readAuthConfig(env),
    ...(workerJob === "" ? {} : { workerJob }),
    ...(webRoot === "" ? {} : { webRoot }),
    ...(pageFetcherUrl === "" ? {} : { pageFetcherUrl }),
  };
}

/** An http or https origin such as `https://fetcher.example`, with at most a trailing slash. */
function isServiceOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      url.username === "" &&
      url.password === "" &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === "" &&
      !value.endsWith("?") &&
      !value.endsWith("#")
    );
  } catch {
    return false;
  }
}

/** A client id or audience: printable, with no whitespace. */
const clientIdentifierPattern = /^[\x21-\x7e]{1,255}$/u;

function clientIdentifier(env: NodeJS.ProcessEnv, name: string): string {
  const value = required(env, name);
  if (!clientIdentifierPattern.test(value)) {
    throw new ApiConfigError(`${name} must be printable with no whitespace.`);
  }
  return value;
}

function authMode(env: NodeJS.ProcessEnv): DeploymentAuthMode {
  try {
    return readDeploymentAuthMode(env);
  } catch (error) {
    if (error instanceof DeploymentAuthModeConfigError) throw new ApiConfigError(error.message);
    throw error;
  }
}

/**
 * Reads how requests are authenticated. Sign-in mode names the identity provider by its issuer;
 * its keys are discovered from the issuer unless `DRAFT_LOOP_OIDC_JWKS_URL` names them. Provider
 * addresses must be https, except on the local stack, which sets `DRAFT_LOOP_OIDC_ALLOW_HTTP=1`.
 */
function readAuthConfig(env: NodeJS.ProcessEnv): ApiAuthConfig {
  if (authMode(env) === "owner") return { mode: "owner" };
  const allowHttpText = env.DRAFT_LOOP_OIDC_ALLOW_HTTP ?? "";
  if (!["", "0", "1"].includes(allowHttpText)) {
    throw new ApiConfigError("DRAFT_LOOP_OIDC_ALLOW_HTTP must be 1 or unset.");
  }
  const allowHttp = allowHttpText === "1";
  const scheme = allowHttp ? "an http or https URL" : "an https URL";
  const issuer = required(env, "DRAFT_LOOP_OIDC_ISSUER");
  if (!isProviderUrl(issuer, allowHttp) || new URL(issuer).search !== "") {
    throw new ApiConfigError(`DRAFT_LOOP_OIDC_ISSUER must be ${scheme} with no query.`);
  }
  const jwksUrl = env.DRAFT_LOOP_OIDC_JWKS_URL ?? "";
  if (jwksUrl !== "" && !isProviderUrl(jwksUrl, allowHttp)) {
    throw new ApiConfigError(`DRAFT_LOOP_OIDC_JWKS_URL must be ${scheme}.`);
  }
  return {
    mode: "oidc",
    issuer,
    audience: clientIdentifier(env, "DRAFT_LOOP_OIDC_AUDIENCE"),
    webClientId: clientIdentifier(env, "DRAFT_LOOP_OIDC_WEB_CLIENT_ID"),
    ...(jwksUrl === "" ? {} : { jwksUrl }),
    allowHttp,
  };
}

export interface HostedStorageConfig {
  /** The runtime role's connection: no superuser and no `BYPASSRLS`, so row-level security holds. */
  readonly databaseUrl: string;
  readonly databaseSchema: string;
  readonly queueSchema: string;
  /**
   * The tenant the owner token acts in: required in owner mode, where it is the only tenant served,
   * and optional in sign-in mode, where each member acts in their own organisation.
   */
  readonly tenantId?: string;
  /** Where the tenants' files live: Cloud Storage, or a directory on a self-hosted stack. */
  readonly blobs: BlobBackendConfig;
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
export function readHostedStorageConfig(
  env: NodeJS.ProcessEnv,
  authMode: ApiAuthConfig["mode"] = "owner",
): HostedStorageConfig {
  const tenantId =
    authMode === "owner" ? required(env, "DRAFT_LOOP_TENANT_ID") : (env.DRAFT_LOOP_TENANT_ID ?? "");
  if (tenantId !== "" && !identifierPattern.test(tenantId)) {
    throw new ApiConfigError("DRAFT_LOOP_TENANT_ID must be a safe identifier.");
  }
  const maxSourceBytes = optionalSourceLimit(env);
  return {
    databaseUrl: required(env, "DRAFT_LOOP_DATABASE_URL"),
    databaseSchema: schemaName(env, "DRAFT_LOOP_DATABASE_SCHEMA", "draft_loop"),
    queueSchema: schemaName(env, "DRAFT_LOOP_QUEUE_SCHEMA", "draft_loop_queue"),
    ...(tenantId === "" ? {} : { tenantId }),
    blobs: readBlobBackend(env),
    ...(maxSourceBytes === undefined ? {} : { maxSourceBytes }),
  };
}
