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

/** The critic's OpenAI client on the EU endpoint; retries stay with the adapter. */
export function createOpenAiEuClient(apiKey: string): OpenAI {
  return new OpenAI({ apiKey, baseURL: openAiEuBaseUrl, maxRetries: 0 });
}

/** A direct Claude API client, used only for the opt-in fallback route. */
export function createAnthropicApiClient(apiKey: string): AnthropicClient {
  return streamingAnthropicClient(new Anthropic({ apiKey, maxRetries: 0 }));
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

/**
 * The hosted author's route: Claude on Vertex AI in an EU location and, only when the deployment
 * allows it, the direct Claude API as a recorded fallback. The Vertex client is built once, so
 * every run shares its authentication.
 */
export function createHostedAnthropicRoute(
  options: HostedAnthropicRouteOptions,
): (input: RouteInput) => RouteAdapter<JsonObject, JsonObject> {
  const { locationPriceFactor, ...clientOptions } = options.vertex;
  const vertexClient = createVertexAnthropicClient(clientOptions);
  const apiClient = options.anthropicApiClient ?? createAnthropicApiClient;
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
    const fallback: RouteAdapter<JsonObject, JsonObject> = {
      provider: "anthropic",
      route: "anthropic-api",
      execute: async (request) => {
        const apiKey = await options.resolveCredential("anthropic");
        if (apiKey === undefined || apiKey.trim() === "") {
          throw new ProviderAdapterError(
            "anthropic",
            "authentication",
            "The Claude API key for the fallback route is not configured.",
            { retryable: false },
          );
        }
        return createAnthropicAdapter<JsonObject, JsonObject>(apiClient(apiKey), {
          ...adapterOptions,
          route: "anthropic-api",
        }).execute(request);
      },
    };
    return createRoutedAdapter({ primary, fallback });
  };
}
