import type { LocalApplicationDriverOptions } from "@draft-loop/application";
import {
  assertLocationPriceFactor,
  type CredentialResolver,
  createHostedAnthropicRoute,
  createOpenAiClient,
  createSecretManagerCredentialResolver,
  type HostedAnthropicRouteOptions,
  type OpenAiEndpoint,
  type SecretVersionReader,
  vertexEuLocation,
} from "@draft-loop/model-gateway";

import { WorkerConfigError } from "./config-error.js";

/**
 * Where the worker's provider calls go. Names and numbers come from the deployment's
 * configuration, never from this repository.
 */
export interface ModelGatewayConfig {
  readonly vertexProjectId: string;
  readonly vertexLocation: string;
  /** The location's price factor over first-party rates, from Google's price list. */
  readonly vertexPriceFactor: number;
  /** The Secret Manager version that holds the critic's OpenAI project key. */
  readonly openAiKeySecret: string;
  /**
   * The critic's OpenAI endpoint: `eu` unless the deployment chose `global`, which processes
   * material outside the EU (ADR 0011) and needs no EU-residency project.
   */
  readonly openAiEndpoint: OpenAiEndpoint;
  /** Present only when the deployment allows the direct Claude API as a fallback. */
  readonly anthropicKeySecret?: string;
}

const optional = (env: NodeJS.ProcessEnv, name: string): string | undefined => {
  const value = env[name] ?? "";
  return value === "" ? undefined : value;
};

/**
 * Reads the gateway settings. Without a Vertex project the worker has no model routes: runs in
 * fixture mode still work, and any provider call fails for want of a key, never from the
 * environment.
 */
export function readModelGatewayConfig(env: NodeJS.ProcessEnv): ModelGatewayConfig | undefined {
  const vertexProjectId = optional(env, "DRAFT_LOOP_VERTEX_PROJECT_ID");
  if (vertexProjectId === undefined) return undefined;
  const vertexLocation = env.DRAFT_LOOP_VERTEX_LOCATION ?? "eu";
  const vertexPriceFactor = Number(env.DRAFT_LOOP_VERTEX_PRICE_FACTOR ?? "");
  const openAiKeySecret = optional(env, "DRAFT_LOOP_OPENAI_KEY_SECRET");
  const openAiEndpoint = env.DRAFT_LOOP_OPENAI_ENDPOINT ?? "eu";
  const fallback = env.DRAFT_LOOP_ANTHROPIC_FALLBACK ?? "false";
  const anthropicKeySecret = optional(env, "DRAFT_LOOP_ANTHROPIC_KEY_SECRET");
  try {
    vertexEuLocation(vertexLocation);
    assertLocationPriceFactor(vertexPriceFactor);
  } catch (error) {
    throw new WorkerConfigError(
      "DRAFT_LOOP_VERTEX_LOCATION must be an EU location and DRAFT_LOOP_VERTEX_PRICE_FACTOR a number of at least 1.",
      { cause: error },
    );
  }
  if (openAiKeySecret === undefined) {
    throw new WorkerConfigError("DRAFT_LOOP_OPENAI_KEY_SECRET is required with a Vertex project.");
  }
  if (openAiEndpoint !== "eu" && openAiEndpoint !== "global") {
    throw new WorkerConfigError("DRAFT_LOOP_OPENAI_ENDPOINT must be eu or global.");
  }
  if (fallback !== "true" && fallback !== "false") {
    throw new WorkerConfigError("DRAFT_LOOP_ANTHROPIC_FALLBACK must be true or false.");
  }
  if (fallback === "true" && anthropicKeySecret === undefined) {
    throw new WorkerConfigError(
      "DRAFT_LOOP_ANTHROPIC_KEY_SECRET is required when the Claude API fallback is on.",
    );
  }
  if (fallback === "false" && anthropicKeySecret !== undefined) {
    throw new WorkerConfigError(
      "DRAFT_LOOP_ANTHROPIC_KEY_SECRET is set but the Claude API fallback is off.",
    );
  }
  return {
    vertexProjectId,
    vertexLocation,
    vertexPriceFactor,
    openAiKeySecret,
    openAiEndpoint,
    ...(anthropicKeySecret === undefined ? {} : { anthropicKeySecret }),
  };
}

/** A resolver that knows no key, so a provider call fails closed instead of reading the env. */
const noCredentials: CredentialResolver = async () => undefined;

export interface ModelRouteDependencies {
  /** A scripted Secret Manager, for tests. */
  readonly secrets?: SecretVersionReader;
  /** Scripted Vertex authentication and transport, for tests. */
  readonly vertex?: Pick<HostedAnthropicRouteOptions["vertex"], "auth" | "fetch">;
  readonly anthropicApiClient?: HostedAnthropicRouteOptions["anthropicApiClient"];
  readonly openAiClient?: (apiKey: string) => ReturnType<typeof createOpenAiClient>;
}

/**
 * The provider wiring the hosted driver runs with: Claude on Vertex AI for the author, OpenAI's
 * EU endpoint (or the global one, where the deployment chose it) for the critic, and keys from
 * Secret Manager.
 */
export function workerProviderOptions(
  config: ModelGatewayConfig | undefined,
  dependencies: ModelRouteDependencies = {},
): Pick<LocalApplicationDriverOptions, "resolveCredential" | "providerClientFactories"> {
  if (config === undefined) return { resolveCredential: noCredentials };
  const resolveCredential = createSecretManagerCredentialResolver({
    secrets: {
      openai: config.openAiKeySecret,
      ...(config.anthropicKeySecret === undefined ? {} : { anthropic: config.anthropicKeySecret }),
    },
    ...(dependencies.secrets === undefined ? {} : { client: dependencies.secrets }),
  });
  const anthropicRoute = createHostedAnthropicRoute({
    vertex: {
      projectId: config.vertexProjectId,
      location: config.vertexLocation,
      locationPriceFactor: config.vertexPriceFactor,
      ...dependencies.vertex,
    },
    anthropicFallback: config.anthropicKeySecret !== undefined,
    resolveCredential,
    ...(dependencies.anthropicApiClient === undefined
      ? {}
      : { anthropicApiClient: dependencies.anthropicApiClient }),
  });
  return {
    resolveCredential,
    providerClientFactories: {
      anthropicRoute,
      openai:
        dependencies.openAiClient ??
        ((apiKey: string) => createOpenAiClient(apiKey, config.openAiEndpoint)),
    },
  };
}
