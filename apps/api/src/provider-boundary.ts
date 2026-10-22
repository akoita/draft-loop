import type { LocalApplicationDriverOptions } from "@draft-loop/application";

/** Why an API process refused to open a model provider. */
export class ApiProviderCallError extends Error {
  constructor(provider: string) {
    super(`The API never calls a model provider (${provider}); the worker runs provider steps.`);
    this.name = "ApiProviderCallError";
  }
}

const refuse = (provider: string) => (): never => {
  throw new ApiProviderCallError(provider);
};

/**
 * The provider wiring the API's hosted driver runs with: no credential and no client, whatever the
 * process environment holds (ADR 0011, D5). Only the worker calls models, through the gateway, so
 * a driver method that would reach a provider from the API fails closed instead of reading
 * `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`.
 */
export function apiProviderOptions(): Pick<
  LocalApplicationDriverOptions,
  "providerAuthMode" | "resolveCredential" | "providerClientFactories"
> {
  return {
    providerAuthMode: "api-key",
    resolveCredential: async () => undefined,
    providerClientFactories: {
      anthropic: refuse("anthropic"),
      anthropicRoute: refuse("anthropic"),
      openai: refuse("openai"),
      deepinfra: refuse("deepinfra"),
      google: refuse("google"),
      mistral: refuse("mistral"),
      local: refuse("local"),
    },
  };
}
