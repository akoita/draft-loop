import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { CredentialProvider, CredentialStatus, ProviderAuthModeStatus } from "./bridge.js";
import { HomeView } from "./home.js";
import {
  ProviderAuthentication,
  ProviderAuthenticationMode,
  ProviderAuthenticationView,
  type ProviderAuthenticationViewProps,
} from "./provider-authentication.js";
import {
  removeProviderCredential,
  saveOpenAiAuthMode,
  saveProviderCredential,
} from "./provider-authentication-actions.js";

function status(
  provider: CredentialProvider,
  overrides: Partial<CredentialStatus> = {},
): CredentialStatus {
  return { provider, configured: false, source: "none", protection: "none", ...overrides };
}

function authMode(overrides: Partial<ProviderAuthModeStatus> = {}): ProviderAuthModeStatus {
  return {
    provider: "openai",
    activeMode: "api-key",
    preferredMode: "api-key",
    restartRequired: false,
    environmentOverride: false,
    ...overrides,
  };
}

function viewProps(
  overrides: Partial<ProviderAuthenticationViewProps> = {},
): ProviderAuthenticationViewProps {
  return {
    statuses: {
      anthropic: status("anthropic"),
      openai: status("openai"),
      deepinfra: status("deepinfra"),
      google: status("google"),
      mistral: status("mistral"),
    },
    openaiAuthMode: authMode(),
    inputs: { anthropic: "", openai: "", deepinfra: "", google: "", mistral: "" },
    revealed: {
      anthropic: false,
      openai: false,
      deepinfra: false,
      google: false,
      mistral: false,
    },
    feedback: null,
    onInputChange: () => undefined,
    onReveal: () => undefined,
    onSave: () => undefined,
    onRemove: () => undefined,
    onModeChange: () => undefined,
    onClose: () => undefined,
    ...overrides,
  };
}

const homeProps = {
  workspaceTitle: <h1>Job search 2026</h1>,
  workspaceNavigation: <button type="button">Close workspace</button>,
  profile: { kind: "reviewed", version: 2 },
  evidence: { kind: "none" },
  legacyEvidenceSourceCount: 0,
  applications: { status: "ready", applications: [] },
  now: new Date("2026-10-08T12:00:00.000Z"),
  onOpenApplication: () => undefined,
  onManageProfile: () => undefined,
  onManageEvidence: () => undefined,
} as const;

describe("provider authentication on Home", () => {
  it("is offered inside Workspace settings", () => {
    const html = renderToStaticMarkup(
      <HomeView
        {...homeProps}
        settings={
          <ProviderAuthentication
            getCredentialStatus={async (provider) => status(provider)}
            onSetCredential={async () => undefined}
          />
        }
      />,
    );

    const settings = html.slice(html.indexOf('aria-labelledby="home-settings-title"'));
    expect(settings).toMatch(/<h2[^>]*>Workspace settings<\/h2>/u);
    expect(settings).toContain('aria-label="Provider authentication"');
    expect(settings).toContain("Manage provider authentication");
    // The dialog stays closed until it is asked for, and never shows a key.
    expect(settings).not.toContain('role="dialog"');
  });

  it("says demo workspaces need no provider authentication", () => {
    const html = renderToStaticMarkup(
      <ProviderAuthentication fixtureMode getCredentialStatus={async (p) => status(p)} />,
    );
    expect(html).toContain("Demo mode (no provider authentication required)");
  });

  it("renders nothing when the host has no credential capability", () => {
    expect(renderToStaticMarkup(<ProviderAuthentication />)).toBe("");
  });
});

describe("provider authentication dialog", () => {
  it("lists every provider with secret-free status and the OpenAI account choice", () => {
    const html = renderToStaticMarkup(<ProviderAuthenticationView {...viewProps()} />);

    expect(html).toContain('role="dialog"');
    for (const title of [
      "Anthropic API key (Claude)",
      "OpenAI API key (GPT)",
      "DeepInfra API key (Z.ai GLM)",
      "Google Gemini API key",
      "Mistral API key",
    ]) {
      expect(html).toContain(`aria-label="${title}"`);
    }
    expect(html).toContain("OpenAI authentication");
    expect(html).toContain('type="password"');
    expect(html).not.toContain(">Remove<");
  });

  it("offers Remove only for a key stored in the app, and shows feedback", () => {
    const base = viewProps();
    const html = renderToStaticMarkup(
      <ProviderAuthenticationView
        {...base}
        statuses={{
          ...base.statuses,
          anthropic: status("anthropic", {
            configured: true,
            source: "app",
            protection: "os-backed",
          }),
        }}
        feedback="Anthropic API key saved in app storage."
      />,
    );

    expect(html.match(/>Remove</gu)?.length).toBe(1);
    expect(html).toContain("Configured in app");
    expect(html).toContain("Anthropic API key saved in app storage.");
  });

  it("offers OpenAI subscription authentication without exposing an API-key editor in session mode", () => {
    const html = renderToStaticMarkup(
      <ProviderAuthenticationView
        {...viewProps({
          openaiAuthMode: authMode({ activeMode: "user-session", preferredMode: "user-session" }),
        })}
      />,
    );

    expect(html).toContain("Authenticated Codex / ChatGPT subscription");
    expect(html).not.toContain("OpenAI API key (GPT)");
  });
});

describe("provider authentication mode", () => {
  it("offers OpenAI subscription authentication without exposing an API-key editor in session mode", () => {
    const html = renderToStaticMarkup(
      <ProviderAuthenticationMode
        status={authMode({ activeMode: "user-session", preferredMode: "user-session" })}
        credentialStatus={status("openai", {
          source: "user-session",
          protection: "provider-managed-session",
        })}
        onChange={() => undefined}
      />,
    );

    expect(html).toContain("Authenticated Codex / ChatGPT subscription");
    expect(html).toContain("Active now: Authenticated Codex / ChatGPT subscription.");
    expect(html).toContain("Codex session: not detected");
    expect(html).toContain("codex login");
    expect(html).not.toContain("OpenAI API key (GPT)");
    expect(html).not.toContain('type="password"');
  });

  it("makes a saved authentication change visibly pending restart", () => {
    const html = renderToStaticMarkup(
      <ProviderAuthenticationMode
        status={authMode({ preferredMode: "user-session", restartRequired: true })}
        credentialStatus={status("openai", {
          configured: true,
          source: "app",
          protection: "os-backed",
        })}
        onChange={() => undefined}
      />,
    );

    expect(html).toContain("Active now: Provider API key.");
    expect(html).toContain("Saved preference: Authenticated Codex / ChatGPT subscription.");
    expect(html).toContain("Close and reopen DraftLoop to apply it");
  });
});

describe("provider authentication actions", () => {
  it("saves a trimmed key through the credential callback", async () => {
    const onSetCredential = vi.fn(async () => undefined);
    const outcome = await saveProviderCredential({ onSetCredential }, "mistral", "  key-123  ");

    expect(onSetCredential).toHaveBeenCalledExactlyOnceWith("mistral", "key-123");
    expect(outcome).toEqual({
      ok: true,
      feedback: "Mistral API key saved in app storage. Review the protection status below.",
    });
  });

  it("does nothing for a blank key or a host without the capability", async () => {
    const onSetCredential = vi.fn(async () => undefined);

    expect(await saveProviderCredential({ onSetCredential }, "openai", "   ")).toBeNull();
    expect(await saveProviderCredential({}, "openai", "key")).toBeNull();
    expect(onSetCredential).not.toHaveBeenCalled();
  });

  it("reports a failed save without echoing the key", async () => {
    const onSetCredential = vi.fn(async () => {
      throw new Error("Credential storage is unavailable.");
    });
    const outcome = await saveProviderCredential({ onSetCredential }, "openai", "sk-secret");

    expect(outcome).toEqual({ ok: false, feedback: "Credential storage is unavailable." });
    expect(outcome?.feedback).not.toContain("sk-secret");
  });

  it("removes a stored key through the remove callback", async () => {
    const onRemoveCredential = vi.fn(async () => undefined);

    expect(await removeProviderCredential({ onRemoveCredential }, "google")).toEqual({
      ok: true,
      feedback: "Google Gemini API key removed from app storage.",
    });
    expect(onRemoveCredential).toHaveBeenCalledExactlyOnceWith("google");

    const failing = vi.fn(async () => {
      throw new Error("no");
    });
    expect(await removeProviderCredential({ onRemoveCredential: failing }, "google")).toEqual({
      ok: false,
      feedback: "Failed to remove API key.",
    });
    expect(await removeProviderCredential({}, "google")).toBeNull();
  });

  it("saves the OpenAI authentication mode and says when a restart applies it", async () => {
    const onSetProviderAuthMode = vi.fn(async (_provider: string, _mode: string) =>
      authMode({ preferredMode: "user-session", restartRequired: true }),
    );
    const outcome = await saveOpenAiAuthMode({ onSetProviderAuthMode }, "user-session");

    expect(onSetProviderAuthMode).toHaveBeenCalledExactlyOnceWith("openai", "user-session");
    expect(outcome?.ok).toBe(true);
    expect(outcome?.status?.restartRequired).toBe(true);
    expect(outcome?.feedback).toContain("Close and reopen DraftLoop to apply it.");
    expect(await saveOpenAiAuthMode({}, "api-key")).toBeNull();
  });
});
