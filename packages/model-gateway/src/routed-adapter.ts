import {
  type JsonValue,
  type ModelRequest,
  type ModelResponse,
  normalizeProviderError,
  type ProviderId,
  type ProviderRoute,
  type RouteFallbackCause,
} from "@draft-loop/providers";

/** A provider adapter that names its company and its route. */
export interface RouteAdapter<
  Input extends JsonValue = JsonValue,
  Output extends JsonValue = JsonValue,
> {
  readonly provider: ProviderId;
  readonly route: ProviderRoute;
  readonly execute: (request: ModelRequest<Input>) => Promise<ModelResponse<Output>>;
}

export interface RoutedAdapterOptions<Input extends JsonValue, Output extends JsonValue> {
  readonly primary: RouteAdapter<Input, Output>;
  /**
   * The fallback route, such as the direct Claude API behind Claude on Vertex AI. Leave it unset
   * unless the deployment's policy allows a fallback: the direct Claude API processes material
   * outside the EU, so the default is no fallback.
   */
  readonly fallback?: RouteAdapter<Input, Output>;
}

export class RoutePolicyError extends Error {
  override readonly name = "RoutePolicyError";
}

/**
 * The listed causes for leaving the primary route. A 404 means the model is not offered there; a
 * timeout, a rate limit or a server error that survived the adapter's retries means the route is
 * unavailable. Every other error, including content and policy errors, stays on the primary.
 */
export function routeFallbackCause(error: unknown): RouteFallbackCause | undefined {
  const normalized = normalizeProviderError("anthropic", error);
  if (
    normalized.status === 404 ||
    normalized.diagnostics.some(({ code }) => code === "vertex_model_not_offered")
  ) {
    return "model-not-offered";
  }
  if (
    normalized.code === "transient" ||
    normalized.code === "timeout" ||
    normalized.code === "rate-limit"
  ) {
    return "route-unavailable";
  }
  return undefined;
}

/**
 * Calls the primary route and, only when the policy gave a fallback and the error is a listed
 * cause, the fallback route. The response then names the fallback route and records where the
 * call came from and why, so run history shows the switch. The company and the model never
 * change, so the same-company warning and model identity rules hold.
 */
export function createRoutedAdapter<
  Input extends JsonValue = JsonValue,
  Output extends JsonValue = JsonValue,
>(options: RoutedAdapterOptions<Input, Output>): RouteAdapter<Input, Output> {
  const { primary, fallback } = options;
  if (fallback !== undefined) {
    if (fallback.provider !== primary.provider) {
      throw new RoutePolicyError("A fallback route must serve the same company as its primary.");
    }
    if (fallback.route === primary.route) {
      throw new RoutePolicyError("A fallback route must differ from its primary.");
    }
  }
  return {
    provider: primary.provider,
    route: primary.route,
    async execute(request) {
      try {
        return await primary.execute(request);
      } catch (error) {
        const cause =
          fallback === undefined || request.signal?.aborted === true
            ? undefined
            : routeFallbackCause(error);
        if (fallback === undefined || cause === undefined) throw error;
        const response = await fallback.execute(request);
        return { ...response, routeFallback: { from: primary.route, cause } };
      }
    },
  };
}
