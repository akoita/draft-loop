import type { RunSnapshot } from "@draft-loop/orchestrator";

export interface RunStepRoute {
  readonly step: "author" | "critic" | "revision";
  readonly route: string;
}

/**
 * The endpoints that served each step's completed calls, in first-use order, so run status shows
 * a route change instead of hiding it (ADR 0011, D5). Calls recorded before routes were kept, and
 * failed calls, carry no route and are left out rather than guessed.
 */
export function runStepRoutes(snapshot: Pick<RunSnapshot, "executionHistory">): RunStepRoute[] {
  const seen = new Set<string>();
  const routes: RunStepRoute[] = [];
  for (const { step, route, status } of snapshot.executionHistory) {
    if (status !== "completed" || route === undefined) continue;
    const key = `${step}\u0000${route}`;
    if (seen.has(key)) continue;
    seen.add(key);
    routes.push({ step, route });
  }
  return routes;
}

/** The status line for {@link runStepRoutes}, such as `routes: author=vertex-ai critic=openai-api`. */
export function runRoutesLine(snapshot: Pick<RunSnapshot, "executionHistory">): string | undefined {
  const routes = runStepRoutes(snapshot);
  if (routes.length === 0) return undefined;
  return `routes: ${routes.map(({ step, route }) => `${step}=${route}`).join(" ")}`;
}
