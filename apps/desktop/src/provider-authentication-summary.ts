import type { ProviderAuthMode } from "./bridge.js";

export interface ProviderAuthenticationSummaryInput {
  readonly fixtureMode: boolean;
  readonly anthropicConfigured: boolean;
  readonly openaiConfigured: boolean;
  readonly anthropicMode: ProviderAuthMode;
  readonly openaiMode: ProviderAuthMode;
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
export function providerAuthenticationSummary({
  fixtureMode,
  anthropicConfigured,
  openaiConfigured,
  anthropicMode,
  openaiMode,
}: ProviderAuthenticationSummaryInput): string {
  if (fixtureMode) return "Demo mode (no provider authentication required)";
  if (!anthropicConfigured || !openaiConfigured) {
    return "Configure provider authentication for live review";
  }
  if (anthropicMode === "api-key" && openaiMode === "api-key") {
    return "Anthropic & OpenAI API keys configured";
  }
  return `Anthropic ${describeMode("Anthropic", anthropicMode)} & OpenAI ${describeMode(
    "OpenAI",
    openaiMode,
  )} configured`;
}
