import { describe, expect, it } from "vitest";

import {
  providerAuthenticationForPair,
  providerAuthenticationSummary,
} from "./provider-authentication-summary.js";

describe("providerAuthenticationSummary", () => {
  it("describes demo mode regardless of configuration", () => {
    expect(
      providerAuthenticationSummary({
        fixtureMode: true,
        anthropicConfigured: false,
        openaiConfigured: false,
        anthropicMode: "api-key",
        openaiMode: "api-key",
      }),
    ).toBe("Demo mode (no provider authentication required)");
  });

  it("prompts for configuration when either provider is unconfigured", () => {
    expect(
      providerAuthenticationSummary({
        fixtureMode: false,
        anthropicConfigured: true,
        openaiConfigured: false,
        anthropicMode: "api-key",
        openaiMode: "api-key",
      }),
    ).toBe("Configure provider authentication for live review");
  });

  it("keeps the exact API-keys-only string when both providers use API keys", () => {
    expect(
      providerAuthenticationSummary({
        fixtureMode: false,
        anthropicConfigured: true,
        openaiConfigured: true,
        anthropicMode: "api-key",
        openaiMode: "api-key",
      }),
    ).toBe("Anthropic & OpenAI API keys configured");
  });

  it("names an OpenAI Codex session when only OpenAI uses a user session", () => {
    expect(
      providerAuthenticationSummary({
        fixtureMode: false,
        anthropicConfigured: true,
        openaiConfigured: true,
        anthropicMode: "api-key",
        openaiMode: "user-session",
      }),
    ).toBe("Anthropic API key & OpenAI Codex session configured");
  });

  it("names an Anthropic Claude session when only Anthropic uses a user session", () => {
    expect(
      providerAuthenticationSummary({
        fixtureMode: false,
        anthropicConfigured: true,
        openaiConfigured: true,
        anthropicMode: "user-session",
        openaiMode: "api-key",
      }),
    ).toBe("Anthropic Claude session & OpenAI API key configured");
  });

  it("names both user sessions when both providers use one", () => {
    expect(
      providerAuthenticationSummary({
        fixtureMode: false,
        anthropicConfigured: true,
        openaiConfigured: true,
        anthropicMode: "user-session",
        openaiMode: "user-session",
      }),
    ).toBe("Anthropic Claude session & OpenAI Codex session configured");
  });

  it("bases readiness on the applied GLM/OpenAI pair and its dedicated DeepInfra key", () => {
    const missingDeepInfra = providerAuthenticationForPair({
      fixtureMode: false,
      anthropicConfigured: false,
      openaiConfigured: true,
      deepinfraConfigured: false,
      anthropicMode: "api-key",
      openaiMode: "api-key",
      authorCompany: "zai",
      criticCompany: "openai",
    });
    expect(missingDeepInfra).toEqual({
      ready: false,
      summary: "Configure DeepInfra API key for live review",
    });

    expect(
      providerAuthenticationForPair({
        fixtureMode: false,
        anthropicConfigured: false,
        openaiConfigured: true,
        deepinfraConfigured: true,
        anthropicMode: "api-key",
        openaiMode: "api-key",
        authorCompany: "zai",
        criticCompany: "openai",
      }),
    ).toEqual({
      ready: true,
      summary: "DeepInfra API key & OpenAI API key configured",
    });
  });

  it("does not require keys for a local side and fails closed for unsupported identities", () => {
    const local = providerAuthenticationForPair({
      fixtureMode: false,
      anthropicConfigured: false,
      openaiConfigured: false,
      anthropicMode: "api-key",
      openaiMode: "api-key",
      authorCompany: "local",
      criticCompany: "local",
    });
    expect(local).toEqual({
      ready: true,
      summary:
        "Local model server (no provider key required) & Local model server (no provider key required) configured",
    });

    const unknown = providerAuthenticationForPair({
      fixtureMode: false,
      anthropicConfigured: false,
      openaiConfigured: false,
      anthropicMode: "api-key",
      openaiMode: "api-key",
      authorCompany: "unknown" as never,
      criticCompany: "openai",
    });
    expect(unknown.ready).toBe(false);
    expect(unknown.summary).toContain("Unsupported provider route");
  });
});
