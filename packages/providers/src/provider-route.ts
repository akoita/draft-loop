/**
 * The endpoint that served a provider call, recorded beside its company and model so that a
 * change of route is never silent (ADR 0011, D5). The company still decides who receives the
 * material; the route says through which service it went.
 */
export const providerRoutes = [
  "anthropic-api",
  "vertex-ai",
  "openai-api",
  "user-session",
  "local",
  "deepinfra-api",
  "gemini-api",
  "mistral-api",
  "fixture",
] as const;

export type ProviderRoute = (typeof providerRoutes)[number];

/** The routes an Anthropic client can reach: the Claude API itself, or Claude on Vertex AI. */
export type AnthropicRoute = Extract<ProviderRoute, "anthropic-api" | "vertex-ai">;

const known: ReadonlySet<string> = new Set(providerRoutes);

export function isProviderRoute(value: unknown): value is ProviderRoute {
  return typeof value === "string" && known.has(value);
}
