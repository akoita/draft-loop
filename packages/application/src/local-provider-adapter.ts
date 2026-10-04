import type { ModelSelection } from "@draft-loop/domain";
import {
  AnthropicAdapter,
  AnthropicClaudeUserSessionAdapter,
  type AnthropicClient,
  createDeepInfraGLMAdapter,
  createDeepInfraGLMClient,
  createGoogleGeminiAdapter,
  createGoogleGeminiClient,
  type DeepInfraGLMClient,
  deepInfraGLMModelId,
  type GoogleGeminiClient,
  googleGeminiCompany,
  isGoogleGeminiSupportedModelId,
  type JsonObject,
  type LocalClient,
  LocalModelAdapter,
  OpenAIAdapter,
  type OpenAIClient,
  OpenAICodexUserSessionAdapter,
  ProviderAdapterError,
  type RetryOptions,
  type UserSessionProcessRunner,
} from "@draft-loop/providers";
import OpenAI from "openai";
import { createAnthropicSdkClient } from "./anthropic-sdk-client.js";
import { developmentProviderRetry } from "./development-provider-retry.js";
import type { ProviderCredentialResolver } from "./glm-provider-routing.js";

export type { ProviderCredentialResolver } from "./glm-provider-routing.js";

/** Concrete local driver shared by CLI and the native desktop host. */
export interface ProviderClientFactories {
  readonly anthropic?: (apiKey: string) => AnthropicClient;
  readonly openai?: (apiKey: string) => OpenAIClient;
  readonly deepinfra?: (apiKey: string) => DeepInfraGLMClient;
  readonly google?: (apiKey: string) => GoogleGeminiClient;
  /**
   * Builds the local transport. Receives the workspace's configured endpoint,
   * or `undefined` when the workspace leaves the adapter default in place.
   */
  readonly local?: (endpoint: string | undefined) => LocalClient;
}

export interface ProviderUserSessionRunners {
  readonly anthropic?: UserSessionProcessRunner;
  readonly openai?: UserSessionProcessRunner;
}

export type { AnthropicClient, LocalClient, OpenAIClient };

type ProviderAuthModeConfiguration = Readonly<
  Record<"anthropic" | "openai", "api-key" | "user-session">
>;

/** Resolve the literal transport company; model lineage remains a separate concern. */
function providerId(
  model: ModelSelection,
): "anthropic" | "openai" | "local" | "deepinfra" | "google" {
  if (model.company === googleGeminiCompany) {
    if (isGoogleGeminiSupportedModelId(model.modelId)) return "google";
    throw new ProviderAdapterError(
      "google",
      "invalid-request",
      "The configured Google model is unsupported.",
      { retryable: false },
    );
  }
  if (model.company === "zai") {
    if (model.modelId === deepInfraGLMModelId) return "deepinfra";
    throw new ProviderAdapterError(
      "deepinfra",
      "invalid-request",
      "The configured Z.ai model is unsupported.",
      { retryable: false },
    );
  }
  const { company } = model;
  if (company === "anthropic") return "anthropic";
  if (company === "openai") return "openai";
  if (company === "local") return "local";
  throw new ProviderAdapterError(
    "anthropic",
    "invalid-request",
    "The workspace provider configuration is unsupported.",
    { retryable: false },
  );
}

export async function createProviderAdapter(
  config: { readonly localEndpoint?: string; readonly retry?: RetryOptions },
  model: ModelSelection,
  allowProviderData: boolean,
  resolveCredential: ProviderCredentialResolver,
  providerClientFactories?: ProviderClientFactories,
  providerAuthModeConfiguration: ProviderAuthModeConfiguration = {
    anthropic: "api-key",
    openai: "api-key",
  },
  userSessionRunners?: ProviderUserSessionRunners,
  userSessionTimeoutMs?: number,
  localClaudeCategoryCaptureParent?: string,
) {
  const provider = providerId(model);
  if (!allowProviderData) {
    throw new ProviderAdapterError(
      provider,
      "policy",
      "Provider transmission is not approved for this request.",
      { retryable: false },
    );
  }
  if (provider === "local") {
    const client: LocalClient =
      providerClientFactories?.local?.(config.localEndpoint) ??
      (config.localEndpoint === undefined ? {} : { endpoint: config.localEndpoint });
    return new LocalModelAdapter<JsonObject, JsonObject>(client, {
      configuredModel: model,
      ...(config.retry === undefined ? {} : { retry: config.retry }),
    });
  }
  if (provider === "deepinfra") {
    const apiKey = await resolveCredential("deepinfra");
    if (apiKey === undefined || apiKey.trim() === "") {
      throw new ProviderAdapterError(
        provider,
        "authentication",
        "The DeepInfra API credential is not configured.",
        { retryable: false },
      );
    }
    const client = providerClientFactories?.deepinfra?.(apiKey) ?? createDeepInfraGLMClient(apiKey);
    return createDeepInfraGLMAdapter<JsonObject, JsonObject>(client, {
      configuredModel: model,
      retry: config.retry ?? developmentProviderRetry,
      pricing: {
        inputUsdPerMillionTokens: 0.15,
        outputUsdPerMillionTokens: 0.5,
        cachedInputUsdPerMillionTokens: 0.03,
      },
    });
  }
  if (provider === "google") {
    const apiKey = await resolveCredential("google");
    if (apiKey === undefined || apiKey.trim() === "") {
      throw new ProviderAdapterError(
        provider,
        "authentication",
        "The Gemini API credential is not configured.",
        { retryable: false },
      );
    }
    const client = providerClientFactories?.google?.(apiKey) ?? createGoogleGeminiClient(apiKey);
    return createGoogleGeminiAdapter<JsonObject, JsonObject>(client, {
      configuredModel: model,
      retry: config.retry ?? developmentProviderRetry,
      // Google's paid-tier list prices through 2026-12-31; they double from 2027-01-01.
      pricing: {
        inputUsdPerMillionTokens: 0.75,
        outputUsdPerMillionTokens: 3.75,
        cachedInputUsdPerMillionTokens: 0.075,
      },
    });
  }
  if (provider === "anthropic") {
    if (providerAuthModeConfiguration.anthropic === "user-session") {
      return new AnthropicClaudeUserSessionAdapter<JsonObject, JsonObject>({
        configuredModel: model,
        ...(userSessionRunners?.anthropic === undefined
          ? {}
          : { runner: userSessionRunners.anthropic }),
        ...(userSessionTimeoutMs === undefined ? {} : { timeoutMs: userSessionTimeoutMs }),
        ...(localClaudeCategoryCaptureParent === undefined
          ? {}
          : { localClaudeCategoryCaptureParent }),
      });
    }
    const apiKey = await resolveCredential("anthropic");
    if (apiKey === undefined || apiKey.trim() === "") {
      throw new ProviderAdapterError(
        provider,
        "authentication",
        "The provider credential is not configured.",
        { retryable: false },
      );
    }
    const client = providerClientFactories?.anthropic?.(apiKey) ?? createAnthropicSdkClient(apiKey);
    return new AnthropicAdapter<JsonObject, JsonObject>(client, {
      configuredModel: model,
      ...(config.retry === undefined ? {} : { retry: config.retry }),
    });
  }
  if (providerAuthModeConfiguration.openai === "user-session") {
    return new OpenAICodexUserSessionAdapter<JsonObject, JsonObject>({
      configuredModel: model,
      ...(userSessionRunners?.openai === undefined ? {} : { runner: userSessionRunners.openai }),
      ...(userSessionTimeoutMs === undefined ? {} : { timeoutMs: userSessionTimeoutMs }),
    });
  }
  const apiKey = await resolveCredential("openai");
  if (apiKey === undefined || apiKey.trim() === "") {
    throw new ProviderAdapterError(
      provider,
      "authentication",
      "The provider credential is not configured.",
      { retryable: false },
    );
  }
  const client = providerClientFactories?.openai?.(apiKey) ?? new OpenAI({ apiKey, maxRetries: 0 });
  return new OpenAIAdapter<JsonObject, JsonObject>(client, {
    configuredModel: model,
    retry: { ...config.retry, maxRetries: config.retry?.maxRetries ?? 0 },
  });
}
