import { checkProviderApiKey } from "@draft-loop/providers";

import type { CredentialTestProvider, CredentialTestResult } from "../credential-test-contract.js";

/** The configured pair of the open workspace, when one is open. */
export interface CredentialTestModelPair {
  readonly author: { readonly company: string; readonly model: string };
  readonly critic: { readonly company: string; readonly model: string };
}

export interface CredentialTestDependencies {
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  readonly timeoutMs?: number;
}

/** The distinct models the open workspace would run on this provider, author first. */
export function credentialTestModels(
  provider: CredentialTestProvider,
  pair: CredentialTestModelPair | undefined,
): readonly string[] {
  if (pair === undefined) return [];
  const models = [pair.author, pair.critic]
    .filter((role) => role.company === provider && role.model.trim() !== "")
    .map((role) => role.model.trim());
  return [...new Set(models)];
}

/**
 * Tests a saved API key against each model the open workspace would use with it, stopping at the
 * first one that does not work. With no such model only the key is checked. The key is read by
 * the caller and used only for the provider request; the result never carries it.
 */
export async function testProviderCredential(
  provider: CredentialTestProvider,
  apiKey: string,
  pair: CredentialTestModelPair | undefined,
  dependencies: CredentialTestDependencies = {},
): Promise<CredentialTestResult> {
  const models = credentialTestModels(provider, pair);
  const checkedAt = () => new Date(dependencies.now?.() ?? Date.now()).toISOString();
  const request = {
    provider,
    apiKey,
    ...(dependencies.fetch === undefined ? {} : { fetch: dependencies.fetch }),
    ...(dependencies.timeoutMs === undefined ? {} : { timeoutMs: dependencies.timeoutMs }),
  };
  if (models.length === 0) {
    const result = await checkProviderApiKey(request);
    // A key that is not tied to a model cannot be missing one.
    const outcome = result.outcome === "no-model-access" ? "unreachable" : result.outcome;
    return {
      provider,
      outcome,
      models: [],
      providerCode: result.providerCode,
      checkedAt: checkedAt(),
    };
  }
  for (const model of models) {
    const result = await checkProviderApiKey({ ...request, model });
    if (result.outcome !== "works") {
      return {
        provider,
        outcome: result.outcome,
        models: [model],
        providerCode: result.providerCode,
        checkedAt: checkedAt(),
      };
    }
  }
  return { provider, outcome: "works", models, providerCode: null, checkedAt: checkedAt() };
}
