import type { RouteFallbackRecord, RunSnapshot } from "@draft-loop/orchestrator";

export interface RunStepRoute {
  readonly step: "author" | "critic" | "revision";
  readonly route: string;
  /** Present when the step's calls on this route fell back from their primary route. */
  readonly fallback?: RouteFallbackRecord;
}

/**
 * The endpoints that served each step's completed calls, in first-use order, so run status shows
 * a route change or a fallback instead of hiding it (ADR 0011, D5). Calls recorded before routes
 * were kept, and failed calls, carry no route and are left out rather than guessed.
 */
export function runStepRoutes(snapshot: Pick<RunSnapshot, "executionHistory">): RunStepRoute[] {
  const seen = new Set<string>();
  const routes: RunStepRoute[] = [];
  for (const { step, route, routeFallback, status } of snapshot.executionHistory) {
    if (status !== "completed" || route === undefined) continue;
    const key = [step, route, routeFallback?.from ?? "", routeFallback?.cause ?? ""].join("\u0000");
    if (seen.has(key)) continue;
    seen.add(key);
    routes.push({
      step,
      route,
      ...(routeFallback === undefined ? {} : { fallback: { ...routeFallback } }),
    });
  }
  return routes;
}

/**
 * The status line for {@link runStepRoutes}, such as
 * `routes: author=anthropic-api(fallback from vertex-ai: route-unavailable) critic=openai-api`.
 */
export function runRoutesLine(snapshot: Pick<RunSnapshot, "executionHistory">): string | undefined {
  const routes = runStepRoutes(snapshot);
  if (routes.length === 0) return undefined;
  const entries = routes.map(({ step, route, fallback }) =>
    fallback === undefined
      ? `${step}=${route}`
      : `${step}=${route}(fallback from ${fallback.from}: ${fallback.cause})`,
  );
  return `routes: ${entries.join(" ")}`;
}
