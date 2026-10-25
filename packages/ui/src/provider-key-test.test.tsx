import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CredentialProvider, CredentialStatus, CredentialTestResult } from "./bridge.js";
import {
  ProviderAuthenticationView,
  type ProviderAuthenticationViewProps,
} from "./provider-authentication.js";
import {
  type CredentialTestState,
  type CredentialTestStates,
  createCredentialTestTracker,
  describeCredentialTest,
} from "./provider-key-test.js";

const checkedAt = "2026-10-24T09:30:00.000Z";
const savedKey = "sk-ant-api03-fictional-saved-key";

function configured(provider: CredentialProvider): CredentialStatus {
  return { provider, configured: true, source: "app", protection: "os-backed" };
}

function result(overrides: Partial<CredentialTestResult> = {}): CredentialTestResult {
  return {
    provider: "anthropic",
    outcome: "works",
    models: ["claude-fictional-5"],
    providerCode: null,
    checkedAt,
    ...overrides,
  };
}

function render(
  states: Partial<Record<CredentialProvider, CredentialTestState>>,
  overrides: Partial<ProviderAuthenticationViewProps> = {},
): string {
  return renderToStaticMarkup(
    <ProviderAuthenticationView
      statuses={{
        anthropic: configured("anthropic"),
        openai: configured("openai"),
        deepinfra: configured("deepinfra"),
        google: { provider: "google", configured: false, source: "none", protection: "none" },
        mistral: configured("mistral"),
      }}
      openaiAuthMode={{
        provider: "openai",
        activeMode: "api-key",
        preferredMode: "api-key",
        restartRequired: false,
        environmentOverride: false,
      }}
      inputs={{ anthropic: "", openai: "", deepinfra: "", google: "", mistral: "" }}
      revealed={{
        anthropic: false,
        openai: false,
        deepinfra: false,
        google: false,
        mistral: false,
      }}
      feedback={null}
      onInputChange={vi.fn()}
      onReveal={vi.fn()}
      onSave={vi.fn()}
      onRemove={vi.fn()}
      keyTests={{ states, onTest: vi.fn() }}
      onClose={vi.fn()}
      {...overrides}
    />,
  );
}

/** The markup of one provider's row. */
function row(html: string, title: string): string {
  const start = html.indexOf(`<section class="credential-row" aria-label="${title}"`);
  expect(start).toBeGreaterThanOrEqual(0);
  return html.slice(start, html.indexOf("</section>", start));
}

const anthropicTitle = "Anthropic API key (Claude)";
const openaiTitle = "OpenAI API key (GPT)";

describe("Test key in the Provider authentication dialog", () => {
  it("offers Test key for saved Anthropic and OpenAI keys only", () => {
    const html = render({});

    expect(row(html, anthropicTitle)).toContain("Test key");
    expect(row(html, openaiTitle)).toContain("Test key");
    expect(row(html, "DeepInfra API key (Z.ai GLM)")).not.toContain("Test key");
    expect(row(html, "Mistral API key")).not.toContain("Test key");
    expect(row(html, "Google Gemini API key")).not.toContain("Test key");
  });

  it("offers no Test key when the host cannot test keys or no key is saved", () => {
    expect(render({}, { keyTests: undefined })).not.toContain("Test key");
    const unsaved = render(
      {},
      {
        statuses: {
          anthropic: {
            provider: "anthropic",
            configured: false,
            source: "none",
            protection: "none",
          },
          openai: { provider: "openai", configured: false, source: "none", protection: "none" },
          deepinfra: {
            provider: "deepinfra",
            configured: false,
            source: "none",
            protection: "none",
          },
          google: { provider: "google", configured: false, source: "none", protection: "none" },
          mistral: { provider: "mistral", configured: false, source: "none", protection: "none" },
        },
      },
    );
    expect(unsaved).not.toContain("Test key");
  });

  it("waits while a replacement key is typed, since it tests the saved one", () => {
    const html = render(
      {},
      { inputs: { anthropic: "sk-ant-new", openai: "", deepinfra: "", google: "", mistral: "" } },
    );

    expect(row(html, anthropicTitle)).toMatch(/<button[^>]*disabled=""[^>]*>Test key<\/button>/u);
    expect(row(html, openaiTitle)).not.toMatch(/disabled=""[^>]*>Test key/u);
  });

  it("shows a working key, a rejected key and no network as three different results", () => {
    const html = render({
      anthropic: { status: "done", result: result() },
      openai: {
        status: "done",
        result: result({ provider: "openai", outcome: "rejected", models: ["gpt-fictional"] }),
      },
    });
    const offline = render({
      anthropic: {
        status: "done",
        result: result({ outcome: "unreachable", models: ["claude-fictional-5"] }),
      },
    });

    expect(row(html, anthropicTitle)).toContain("<strong>Works.</strong>");
    expect(row(html, anthropicTitle)).toContain("claude-fictional-5 is available");
    expect(row(html, openaiTitle)).toContain("<strong>Rejected.</strong>");
    expect(row(offline, anthropicTitle)).toContain("<strong>Could not check.</strong>");
    expect(row(offline, anthropicTitle)).not.toContain("Rejected");
    for (const markup of [html, offline]) {
      expect(markup).toContain(`<time dateTime="${checkedAt}">`);
      expect(markup).not.toContain(savedKey);
    }
  });

  it("names the missing model and the provider's limit token", () => {
    expect(
      describeCredentialTest(
        result({ outcome: "no-model-access", models: ["claude-fictional-5"] }),
      ),
    ).toMatchObject({ label: "No access to the model" });
    expect(describeCredentialTest(result({ outcome: "no-model-access" })).detail).toContain(
      "claude-fictional-5 is not available",
    );
    const quota = describeCredentialTest(
      result({
        provider: "openai",
        outcome: "limited",
        models: [],
        providerCode: "insufficient_quota",
      }),
    );
    expect(quota.label).toBe("Quota or rate limit");
    expect(quota.detail).toContain("insufficient_quota");
    expect(describeCredentialTest(result({ models: [] })).detail).toContain("no model was checked");
  });

  it("shows a host refusal as could not check", () => {
    const html = render({
      anthropic: {
        status: "failed",
        message: "No API key is configured for this provider.",
        checkedAt,
      },
    });

    expect(row(html, anthropicTitle)).toContain("<strong>Could not check.</strong>");
    expect(row(html, anthropicTitle)).toContain("No API key is configured");
  });
});

describe("createCredentialTestTracker", () => {
  it("records a test from testing to its result", async () => {
    const published: CredentialTestStates[] = [];
    const tracker = createCredentialTestTracker(
      async () => result(),
      (states) => published.push(states),
    );

    await tracker.test("anthropic");

    expect(published.map((states) => states.anthropic?.status)).toEqual(["testing", "done"]);
    expect(tracker.states().anthropic).toEqual({ status: "done", result: result() });
  });

  it("clears the result when the key is edited, saved or removed", async () => {
    const tracker = createCredentialTestTracker(async () => result(), vi.fn());
    await tracker.test("anthropic");

    tracker.clear("anthropic");

    expect(tracker.states().anthropic).toBeUndefined();
  });

  it("drops an answer that arrives after the key was edited", async () => {
    let answer: (value: CredentialTestResult) => void = () => undefined;
    const tracker = createCredentialTestTracker(
      () =>
        new Promise<CredentialTestResult>((resolve) => {
          answer = resolve;
        }),
      vi.fn(),
    );

    const pending = tracker.test("openai");
    tracker.clear("openai");
    answer(result({ provider: "openai" }));
    await pending;

    expect(tracker.states().openai).toBeUndefined();
  });

  it("keeps a host refusal as a could-not-check message", async () => {
    const tracker = createCredentialTestTracker(
      async () => {
        throw new Error("Test key checks API keys, not user sessions.");
      },
      vi.fn(),
      () => new Date(checkedAt),
    );

    await tracker.test("openai");

    expect(tracker.states().openai).toEqual({
      status: "failed",
      message: "Test key checks API keys, not user sessions.",
      checkedAt,
    });
  });
});
