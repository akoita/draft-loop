import Anthropic from "@anthropic-ai/sdk";
import type { ModelSelection } from "@draft-loop/domain";
import {
  type AnthropicClient,
  createAnthropicAdapter,
  type JsonObject,
  type ModelPricing,
  ProviderAdapterError,
  type RetryOptions,
} from "@draft-loop/providers";
import OpenAI from "openai";

import { createRoutedAdapter, type RouteAdapter } from "./routed-adapter.js";
import type { CredentialResolver } from "./secret-credentials.js";
import {
  createVertexAnthropicAdapter,
  createVertexAnthropicClient,
  streamingAnthropicClient,
  type VertexAnthropicClientOptions,
} from "./vertex-client.js";

/** OpenAI's European data-residency endpoint, for a project created with EU residency. */
export const openAiEuBaseUrl = "https://eu.api.openai.com/v1";

/** OpenAI's global endpoint, which processes material outside the EU. */
export const openAiGlobalBaseUrl = "https://api.openai.com/v1";

/**
 * Which OpenAI endpoint the critic calls. `eu` is the default; `global` exists only for a
 * deployment whose OpenAI organization cannot create EU-residency projects, and the deployment
 * turns it on explicitly.
 */
export type OpenAiEndpoint = "eu" | "global";

/** The critic's OpenAI client on the EU endpoint; retries stay with the adapter. */
export function createOpenAiEuClient(apiKey: string): OpenAI {
  return createOpenAiClient(apiKey, "eu");
}

/** The critic's OpenAI client on the chosen endpoint; retries stay with the adapter. */
export function createOpenAiClient(apiKey: string, endpoint: OpenAiEndpoint): OpenAI {
  const baseURL = endpoint === "eu" ? openAiEuBaseUrl : openAiGlobalBaseUrl;
  return new OpenAI({ apiKey, baseURL, maxRetries: 0 });
}

/**
 * A direct Claude API client, for the opt-in fallback route and the self-hosted `direct` routes.
 * Retries stay with the adapter; `fetch` replaces the transport, for tests.
 */
export function createAnthropicApiClient(
  apiKey: string,
  options: { readonly fetch?: typeof fetch } = {},
): AnthropicClient {
  return streamingAnthropicClient(
    new Anthropic({
      apiKey,
      maxRetries: 0,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    }),
  );
}

export interface HostedAnthropicRouteOptions {
  readonly vertex: VertexAnthropicClientOptions & { readonly locationPriceFactor: number };
  /**
   * Whether a call may fall back to the direct Claude API. It processes material outside the EU,
   * so a deployment turns it on explicitly; its key then comes from `resolveCredential`.
   */
  readonly anthropicFallback: boolean;
  readonly resolveCredential: CredentialResolver;
  /** A scripted direct-API client, for tests. */
  readonly anthropicApiClient?: (apiKey: string) => AnthropicClient;
}

interface RouteInput {
  readonly configuredModel: ModelSelection;
  readonly pricing?: ModelPricing;
  readonly retry?: RetryOptions;
}

/** Builds the Anthropic route for one model: Vertex AI with its fallback, or the Claude API. */
export type AnthropicRouteBuilder = (input: RouteInput) => RouteAdapter<JsonObject, JsonObject>;

export interface DirectAnthropicRouteOptions {
  /** Resolves the Claude API key at call time, so a rotated key takes effect without a restart. */
  readonly resolveCredential: CredentialResolver;
  /** A scripted direct-API client, for tests. */
  readonly anthropicApiClient?: (apiKey: string) => AnthropicClient;
}

/**
 * The Claude API itself, with the key resolved at each call: the hosted route's opt-in fallback,
 * and the self-hosted `direct` route (ADR 0011, D5). It processes material outside the EU, so a
 * deployment chooses it explicitly.
 */
export function createDirectAnthropicRoute(
  options: DirectAnthropicRouteOptions,
): AnthropicRouteBuilder {
  const apiClient = options.anthropicApiClient ?? createAnthropicApiClient;
  return (input) => ({
    provider: "anthropic",
    route: "anthropic-api",
    execute: async (request) => {
      const apiKey = await options.resolveCredential("anthropic");
      if (apiKey === undefined || apiKey.trim() === "") {
        throw new ProviderAdapterError(
          "anthropic",
          "authentication",
          "The Claude API key is not configured.",
          { retryable: false, route: "anthropic-api" },
        );
      }
      return createAnthropicAdapter<JsonObject, JsonObject>(apiClient(apiKey), {
        configuredModel: input.configuredModel,
        ...(input.pricing === undefined ? {} : { pricing: input.pricing }),
        ...(input.retry === undefined ? {} : { retry: input.retry }),
        route: "anthropic-api",
      }).execute(request);
    },
  });
}

/**
 * The hosted author's route: Claude on Vertex AI in an EU location and, only when the deployment
 * allows it, the direct Claude API as a recorded fallback. The Vertex client is built once, so
 * every run shares its authentication.
 */
export function createHostedAnthropicRoute(
  options: HostedAnthropicRouteOptions,
): AnthropicRouteBuilder {
  const { locationPriceFactor, ...clientOptions } = options.vertex;
  const vertexClient = createVertexAnthropicClient(clientOptions);
  const direct = createDirectAnthropicRoute({
    resolveCredential: options.resolveCredential,
    ...(options.anthropicApiClient === undefined
      ? {}
      : { anthropicApiClient: options.anthropicApiClient }),
  });
  return (input) => {
    const adapterOptions = {
      configuredModel: input.configuredModel,
      ...(input.pricing === undefined ? {} : { pricing: input.pricing }),
      ...(input.retry === undefined ? {} : { retry: input.retry }),
    };
    const primary = createVertexAnthropicAdapter<JsonObject, JsonObject>(vertexClient, {
      ...adapterOptions,
      locationPriceFactor,
    });
    if (!options.anthropicFallback) return primary;
    return createRoutedAdapter({ primary, fallback: direct(input) });
  };
}
