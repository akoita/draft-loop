import { AnthropicVertex } from "@anthropic-ai/vertex-sdk";
import {
  type AnthropicAdapter,
  type AnthropicClient,
  createAnthropicAdapter,
  type JsonValue,
  type ModelPricing,
  ProviderAdapterError,
  type ProviderAdapterOptions,
} from "@draft-loop/providers";

import { type VertexEuLocation, vertexBaseUrl, vertexEuLocation } from "./vertex-location.js";
import { isVertexClaudeModel } from "./vertex-models.js";
import { assertLocationPriceFactor, vertexPricing } from "./vertex-pricing.js";

export interface VertexAnthropicClientOptions {
  /** The deployment's Google Cloud project; it comes from the runtime, never from this repository. */
  readonly projectId: string;
  readonly location: string;
  /**
   * Authentication. Left unset, the client uses the runtime's service identity through Application
   * Default Credentials, so no long-lived key exists. Tests pass a scripted auth client.
   */
  readonly auth?: Pick<
    ConstructorParameters<typeof AnthropicVertex>[0] & object,
    "authClient" | "googleAuth"
  >;
  /** A scripted transport, for tests. */
  readonly fetch?: typeof fetch;
}

function refuseUnlistedModel(modelId: string): void {
  if (isVertexClaudeModel(modelId)) return;
  throw new ProviderAdapterError(
    "anthropic",
    "invalid-request",
    "The model is not offered through Claude on Vertex AI.",
    { retryable: false, diagnostics: [{ code: "vertex_model_not_offered", path: "model" }] },
  );
}

/**
 * An Anthropic client that reaches Claude on Vertex AI in an EU location (ADR 0011, D5 and D14).
 * It keeps the provider package's client contract, so the shared author code runs unchanged, and
 * leaves retries to the adapter as the Claude API client does.
 */
export function createVertexAnthropicClient(
  options: VertexAnthropicClientOptions,
): AnthropicClient {
  const location: VertexEuLocation = vertexEuLocation(options.location);
  if (options.projectId.trim() === "") throw new RangeError("A Vertex AI project is required.");
  const client = new AnthropicVertex({
    projectId: options.projectId,
    region: location,
    baseURL: vertexBaseUrl(location),
    maxRetries: 0,
    ...(options.auth ?? {}),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });

  return {
    messages: {
      create(parameters, requestOptions) {
        refuseUnlistedModel(parameters.model);
        const stream = client.messages.stream(parameters, requestOptions);
        const finalMessage = stream.finalMessage();

        return Object.assign(finalMessage, {
          withResponse: async () => {
            const data = await finalMessage;
            const requestId = stream.request_id;
            return {
              data,
              ...(requestId === undefined || requestId === null ? {} : { request_id: requestId }),
            };
          },
        });
      },
    },
  };
}

export interface VertexAnthropicAdapterOptions extends ProviderAdapterOptions {
  /** First-party rates; the adapter applies the location's factor to them. */
  readonly pricing?: ModelPricing;
  readonly locationPriceFactor: number;
}

/**
 * The Anthropic adapter over a Vertex client: Vertex prices, the `vertex-ai` route in run history,
 * and an unlisted model refused before any call.
 */
export function createVertexAnthropicAdapter<
  Input extends JsonValue = JsonValue,
  Output extends JsonValue = JsonValue,
>(
  client: AnthropicClient,
  options: VertexAnthropicAdapterOptions,
): AnthropicAdapter<Input, Output> {
  refuseUnlistedModel(options.configuredModel.modelId);
  assertLocationPriceFactor(options.locationPriceFactor);
  const { locationPriceFactor, pricing, ...rest } = options;
  return createAnthropicAdapter<Input, Output>(client, {
    ...rest,
    ...(pricing === undefined ? {} : { pricing: vertexPricing(pricing, locationPriceFactor) }),
    route: "vertex-ai",
  });
}
