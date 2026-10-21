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

/**
 * Why a call left its primary route: the model is not offered there, or the route refused after
 * the adapter's own retries. Content errors, policy refusals and budgets never cause a fallback.
 */
export const routeFallbackCauses = ["model-not-offered", "route-unavailable"] as const;

export type RouteFallbackCause = (typeof routeFallbackCauses)[number];

/** A fallback a call took, recorded in run history so that it is never silent (ADR 0011, D5). */
export interface RouteFallback {
  readonly from: ProviderRoute;
  readonly cause: RouteFallbackCause;
}
