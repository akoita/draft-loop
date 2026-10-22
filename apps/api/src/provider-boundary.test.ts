import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiProviderCallError, apiProviderOptions } from "./provider-boundary.js";

describe("the API's provider wiring", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("resolves no credential even when the environment holds provider keys", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-anthropic-key");
    vi.stubEnv("OPENAI_API_KEY", "synthetic-openai-key");
    const { resolveCredential } = apiProviderOptions();

    for (const provider of ["anthropic", "openai", "deepinfra", "google", "mistral"] as const) {
      await expect(resolveCredential?.(provider)).resolves.toBeUndefined();
    }
  });

  it("refuses to build a client for any provider, including a local endpoint", () => {
    const factories = apiProviderOptions().providerClientFactories ?? {};
    const builders = Object.entries(factories);

    expect(builders.map(([name]) => name).sort()).toEqual([
      "anthropic",
      "anthropicRoute",
      "deepinfra",
      "google",
      "local",
      "mistral",
      "openai",
    ]);
    for (const [, build] of builders) {
      expect(() => (build as (argument: unknown) => unknown)("synthetic-key")).toThrow(
        ApiProviderCallError,
      );
    }
  });

  it("uses API keys, never a signed-in subscription session", () => {
    expect(apiProviderOptions().providerAuthMode).toBe("api-key");
  });
});
