import type { ModelCompany, ProviderAuthMode } from "./bridge.js";

export interface ProviderAuthenticationSummaryInput {
  readonly fixtureMode: boolean;
  readonly anthropicConfigured: boolean;
  readonly openaiConfigured: boolean;
  readonly anthropicMode: ProviderAuthMode;
  readonly openaiMode: ProviderAuthMode;
  readonly deepinfraConfigured?: boolean;
  readonly authorCompany?: ModelCompany;
  readonly criticCompany?: ModelCompany;
}

export interface ProviderAuthenticationSummary {
  readonly ready: boolean;
  readonly summary: string;
}

const describeMode = (provider: "Anthropic" | "OpenAI", mode: ProviderAuthMode): string => {
  if (provider === "Anthropic") {
    return mode === "user-session" ? "Claude session" : "API key";
  }
  return mode === "user-session" ? "Codex session" : "API key";
};

/**
 * Describes the "Provider authentication" setup card text for the desktop
 * review workspace. Each provider can independently use an API key or an
 * authenticated user session, so the summary names each provider's active
 * mode rather than assuming both providers share one mode.
 */
export function providerAuthenticationForPair({
  fixtureMode,
  anthropicConfigured,
  openaiConfigured,
  anthropicMode,
  openaiMode,
  deepinfraConfigured = false,
  authorCompany,
  criticCompany,
}: ProviderAuthenticationSummaryInput): ProviderAuthenticationSummary {
  if (fixtureMode) {
    return { ready: true, summary: "Demo mode (no provider authentication required)" };
  }

  // Keep the legacy pair wording stable while making its readiness derive from
  // the same applied destinations shown in the transmission preflight.
  if (authorCompany === undefined || criticCompany === undefined) {
    const ready = anthropicConfigured && openaiConfigured;
    if (!ready) {
      return { ready, summary: "Configure provider authentication for live review" };
    }
    if (anthropicMode === "api-key" && openaiMode === "api-key") {
      return { ready, summary: "Anthropic & OpenAI API keys configured" };
    }
    return {
      ready,
      summary: `Anthropic ${describeMode("Anthropic", anthropicMode)} & OpenAI ${describeMode(
        "OpenAI",
        openaiMode,
      )} configured`,
    };
  }

  const describeCompany = (company: ModelCompany): { ready: boolean; text: string } => {
    switch (company) {
      case "anthropic":
        return {
          ready: anthropicConfigured,
          text: `Anthropic ${describeMode("Anthropic", anthropicMode)}`,
        };
      case "openai":
        return { ready: openaiConfigured, text: `OpenAI ${describeMode("OpenAI", openaiMode)}` };
      case "zai":
        return { ready: deepinfraConfigured, text: "DeepInfra API key" };
      case "local":
        return { ready: true, text: "Local model server (no provider key required)" };
      default:
        return { ready: false, text: "Unsupported provider route" };
    }
  };

  const author = describeCompany(authorCompany);
  const critic = describeCompany(criticCompany);
  const ready = author.ready && critic.ready;
  if (ready) return { ready, summary: `${author.text} & ${critic.text} configured` };
  const missing = [author, critic]
    .filter((provider) => !provider.ready)
    .map((provider) => provider.text);
  return { ready, summary: `Configure ${missing.join(" and ")} for live review` };
}

export function providerAuthenticationSummary(input: ProviderAuthenticationSummaryInput): string {
  return providerAuthenticationForPair(input).summary;
}
