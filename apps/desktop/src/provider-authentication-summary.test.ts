import { describe, expect, it } from "vitest";

import { providerAuthenticationSummary } from "./provider-authentication-summary.js";

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
});
