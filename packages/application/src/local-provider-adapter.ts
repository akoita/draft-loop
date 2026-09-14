import Anthropic from "@anthropic-ai/sdk";
import type { ModelSelection } from "@draft-loop/domain";
import {
  AnthropicAdapter,
  AnthropicClaudeUserSessionAdapter,
  type AnthropicClient,
  type JsonObject,
  type LocalClient,
  LocalModelAdapter,
  OpenAIAdapter,
  type OpenAIClient,
  OpenAICodexUserSessionAdapter,
  ProviderAdapterError,
  type UserSessionProcessRunner,
} from "@draft-loop/providers";
import OpenAI from "openai";

/** Concrete local driver shared by CLI and the native desktop host. */
export type ProviderCredentialResolver = (
  provider: "anthropic" | "openai",
) => Promise<string | undefined>;

export interface ProviderClientFactories {
  readonly anthropic?: (apiKey: string) => AnthropicClient;
  readonly openai?: (apiKey: string) => OpenAIClient;
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
function providerId(company: string): "anthropic" | "openai" | "local" {
  if (company === "anthropic" || company === "openai" || company === "local") return company;
  throw new ProviderAdapterError(
    "anthropic",
    "invalid-request",
    "The workspace provider configuration is unsupported.",
    { retryable: false },
  );
}

export async function createProviderAdapter(
  config: { readonly localEndpoint?: string },
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
  const provider = providerId(model.company);
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
    return new LocalModelAdapter<JsonObject, JsonObject>(client, { configuredModel: model });
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
    const client =
      providerClientFactories?.anthropic?.(apiKey) ??
      (new Anthropic({ apiKey, maxRetries: 0 }) as unknown as AnthropicClient);
    return new AnthropicAdapter<JsonObject, JsonObject>(client, { configuredModel: model });
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
  return new OpenAIAdapter<JsonObject, JsonObject>(client, { configuredModel: model });
}
