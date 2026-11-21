import { isAbsolute } from "node:path";
import {
  assertLocationPriceFactor,
  defaultSecretsDirectory,
  vertexClaudeLocation,
} from "@draft-loop/model-gateway";

import { ApiConfigError } from "./config.js";

/**
 * How the API screens untrusted text for prompt injection at intake (ADR 0011, phase 2d).
 * `off` screens nothing, `rules` runs the deterministic rule screener, and `rules+model` adds
 * Claude Haiku on the hosted Vertex route, or on the Claude API where the deployment's routes are
 * `direct` (a self-hosted stack, ADR 0011, D15). A run is refused on quarantined material in every
 * mode, so `off` only stops new results from being stored.
 */
export const screeningModes = ["off", "rules", "rules+model"] as const;
export type ScreeningMode = (typeof screeningModes)[number];

/**
 * The EU Vertex route the model screener and the career interviewer call. The API holds a Claude
 * API key only when the deployment turns on the direct fallback, the same one the worker reads.
 */
export interface ScreeningModelRoute {
  readonly vertexProjectId: string;
  readonly vertexLocation: string;
  /** The location's price factor over first-party rates, from Google's price list. */
  readonly vertexPriceFactor: number;
  /**
   * The Secret Manager version of the Claude API key, present only when the deployment allows the
   * direct Claude API as a recorded fallback (`DRAFT_LOOP_ANTHROPIC_FALLBACK`). It processes
   * material outside the EU, so it is off unless turned on.
   */
  readonly anthropicKeySecret?: string;
}

export interface ScreeningConfig {
  readonly mode: ScreeningMode;
  /**
   * The deployment's ceiling on sending candidate material to a provider, the same
   * `DRAFT_LOOP_ALLOW_PROVIDER_DATA` the worker reads. Consent stays below it: the model screener
   * reads a candidate source only when this is on and the record's consent names Anthropic.
   */
  readonly allowProviderData: boolean;
  /** Present with `rules+model` on the Vertex routes. */
  readonly model?: ScreeningModelRoute;
  /** Present with `rules+model` on the `direct` routes, in place of `model`. */
  readonly direct?: ScreeningDirectRoute;
}

/** The Claude API route of a self-hosted stack, with its key in a file the API reads. */
export interface ScreeningDirectRoute {
  /** The directory holding `anthropic_api_key`, the same `DRAFT_LOOP_SECRETS_DIR` as the worker. */
  readonly secretsDirectory: string;
}

function isScreeningMode(value: string): value is ScreeningMode {
  return (screeningModes as readonly string[]).includes(value);
}

function flag(env: NodeJS.ProcessEnv, name: string): boolean {
  const value = env[name] ?? "false";
  if (value !== "true" && value !== "false") {
    throw new ApiConfigError(`${name} must be true or false.`);
  }
  return value === "true";
}

function readModelRoute(env: NodeJS.ProcessEnv): ScreeningModelRoute {
  const vertexProjectId = env.DRAFT_LOOP_VERTEX_PROJECT_ID ?? "";
  if (vertexProjectId === "") {
    throw new ApiConfigError(
      "DRAFT_LOOP_VERTEX_PROJECT_ID is required when DRAFT_LOOP_SCREENING is rules+model.",
    );
  }
  const vertexLocation = env.DRAFT_LOOP_VERTEX_LOCATION ?? "eu";
  const vertexPriceFactor = Number(env.DRAFT_LOOP_VERTEX_PRICE_FACTOR ?? "");
  try {
    vertexClaudeLocation(vertexLocation);
    assertLocationPriceFactor(vertexPriceFactor);
  } catch (error) {
    throw new ApiConfigError(
      `DRAFT_LOOP_VERTEX_LOCATION must be the eu multi-region and DRAFT_LOOP_VERTEX_PRICE_FACTOR a number of at least 1: ${(error as Error).message}`,
      { cause: error },
    );
  }
  const anthropicKeySecret = readAnthropicFallback(env);
  return {
    vertexProjectId,
    vertexLocation,
    vertexPriceFactor,
    ...(anthropicKeySecret === undefined ? {} : { anthropicKeySecret }),
  };
}

/** The worker's fallback settings, checked the same way: a key exactly when the fallback is on. */
function readAnthropicFallback(env: NodeJS.ProcessEnv): string | undefined {
  const on = flag(env, "DRAFT_LOOP_ANTHROPIC_FALLBACK");
  const keySecret = env.DRAFT_LOOP_ANTHROPIC_KEY_SECRET ?? "";
  if (on && keySecret === "") {
    throw new ApiConfigError(
      "DRAFT_LOOP_ANTHROPIC_KEY_SECRET is required when the Claude API fallback is on.",
    );
  }
  if (!on && keySecret !== "") {
    throw new ApiConfigError(
      "DRAFT_LOOP_ANTHROPIC_KEY_SECRET is set but the Claude API fallback is off.",
    );
  }
  return on ? keySecret : undefined;
}

function readDirectRoute(env: NodeJS.ProcessEnv): ScreeningDirectRoute {
  if ((env.DRAFT_LOOP_VERTEX_PROJECT_ID ?? "") !== "") {
    throw new ApiConfigError(
      "DRAFT_LOOP_VERTEX_PROJECT_ID belongs to the vertex routes; remove it when DRAFT_LOOP_MODEL_ROUTES is direct.",
    );
  }
  const secretsDirectory = env.DRAFT_LOOP_SECRETS_DIR || defaultSecretsDirectory;
  if (!isAbsolute(secretsDirectory)) {
    throw new ApiConfigError("DRAFT_LOOP_SECRETS_DIR must be an absolute path.");
  }
  return { secretsDirectory };
}

/**
 * Reads `DRAFT_LOOP_SCREENING` (default `rules`), the same in owner-token and sign-in mode. An
 * unknown value is a startup error, never a silent fallback to a weaker mode. `rules+model` needs
 * the Vertex project, location and price factor that the worker reads, and optionally its direct
 * Claude API fallback, or, with `DRAFT_LOOP_MODEL_ROUTES=direct`, a Claude API key file in
 * `DRAFT_LOOP_SECRETS_DIR`.
 */
export function readScreeningConfig(env: NodeJS.ProcessEnv): ScreeningConfig {
  const value = env.DRAFT_LOOP_SCREENING ?? "";
  const mode = value === "" ? "rules" : value;
  if (!isScreeningMode(mode)) {
    throw new ApiConfigError(`DRAFT_LOOP_SCREENING must be one of ${screeningModes.join(", ")}.`);
  }
  const allowProviderData = flag(env, "DRAFT_LOOP_ALLOW_PROVIDER_DATA");
  return {
    mode,
    allowProviderData,
    ...(mode !== "rules+model"
      ? {}
      : env.DRAFT_LOOP_MODEL_ROUTES === "direct"
        ? { direct: readDirectRoute(env) }
        : { model: readModelRoute(env) }),
  };
}
