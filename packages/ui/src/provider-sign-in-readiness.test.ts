import { describe, expect, it } from "vitest";
import type { CredentialProvider, CredentialStatus } from "./bridge.js";
import {
  credentialProvidersForRoute,
  emptyCredentialStatus,
  mapProviders,
  type ProviderSignInReadinessInput,
  providerSignInReadiness,
  type ReadOutcome,
  serverHeldProviderSignIn,
} from "./provider-sign-in-readiness.js";
import { type StartChecklistInput, startChecklist } from "./start-checklist-model.js";

function statuses(
  overrides: Partial<Record<CredentialProvider, Partial<CredentialStatus>>> = {},
): ProviderSignInReadinessInput["statuses"] {
  return mapProviders((provider) => ({
    ...emptyCredentialStatus(provider),
    ...overrides[provider],
  }));
}

function outcomes(
  overrides: Partial<Record<CredentialProvider, ReadOutcome>> = {},
): ProviderSignInReadinessInput["outcomes"] {
  return mapProviders((provider) => overrides[provider] ?? "read");
}

const apiKeys: ProviderSignInReadinessInput = {
  loaded: true,
  fixtureMode: false,
  statuses: statuses({
    anthropic: { configured: true, source: "app", protection: "os-backed" },
    openai: { configured: true, source: "env", protection: "environment" },
  }),
  outcomes: outcomes(),
  anthropicMode: "api-key",
  openaiMode: "api-key",
  authorCompany: "anthropic",
  criticCompany: "openai",
};

describe("provider sign-in readiness", () => {
  it("is ready when both API keys are configured", () => {
    expect(providerSignInReadiness(apiKeys)).toEqual({
      state: "ready",
      summary: "Anthropic API key & OpenAI API key configured",
    });
  });

  it("is ready for a session route only when the host reports the CLI signed in", () => {
    const signedIn = {
      ...apiKeys,
      statuses: statuses({
        anthropic: {
          configured: true,
          source: "user-session",
          protection: "provider-managed-session",
        },
        openai: {
          configured: true,
          source: "user-session",
          protection: "provider-managed-session",
        },
      }),
      anthropicMode: "user-session" as const,
      openaiMode: "user-session" as const,
    };
    expect(providerSignInReadiness(signedIn)).toEqual({
      state: "ready",
      summary: "Anthropic Claude session & OpenAI Codex session configured",
    });
  });

  it("is missing when a read reports the route not signed in", () => {
    const missing = {
      ...apiKeys,
      statuses: statuses({
        anthropic: { configured: true, source: "app", protection: "os-backed" },
        openai: {
          configured: false,
          source: "user-session",
          protection: "provider-managed-session",
        },
      }),
      openaiMode: "user-session" as const,
    };
    expect(providerSignInReadiness(missing)).toEqual({
      state: "missing",
      summary: "Configure OpenAI Codex session for live review",
    });
  });

  it("is unknown while the reads are pending or when the route's read failed", () => {
    expect(providerSignInReadiness({ ...apiKeys, loaded: false })).toEqual({
      state: "unknown",
      summary: null,
    });
    const failed = providerSignInReadiness({
      ...apiKeys,
      statuses: statuses({ anthropic: { configured: true } }),
      outcomes: outcomes({ openai: "failed" }),
    });
    expect(failed.state).toBe("unknown");
  });

  it("ignores a failed read for a provider the route does not use", () => {
    expect(
      providerSignInReadiness({ ...apiKeys, outcomes: outcomes({ mistral: "failed" }) }).state,
    ).toBe("ready");
  });

  it("reads only the credentials the pair uses", () => {
    expect(credentialProvidersForRoute("anthropic", "openai")).toEqual(["anthropic", "openai"]);
    expect(credentialProvidersForRoute("zai", "local")).toEqual(["deepinfra"]);
    expect(credentialProvidersForRoute(undefined, "openai")).toEqual(["anthropic", "openai"]);
  });
});

describe("server-held provider keys", () => {
  const input: StartChecklistInput = {
    setup: {
      ready: true,
      nextSteps: [],
      jobDescriptionReady: true,
      jobRequirementProblem: null,
      fixtureMode: false,
      reviewedOpportunity: { briefId: "target-role", version: 3 },
    },
    startFromJobDescription: false,
    requirementAction: null,
    candidateProfile: { version: 2 },
    transmission: { required: true, acknowledged: true },
    startDisabledReason: null,
    canOpenProviderSignIn: true,
    providerSignIn: serverHeldProviderSignIn(),
  };

  it("reads the sign-in row as done with nothing to open (#2866)", () => {
    const row = startChecklist(input).find((condition) => condition.id === "provider-sign-in");
    expect(row).toMatchObject({
      done: true,
      detail: "The service provides the models.",
      action: null,
    });
  });
});
