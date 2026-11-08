import type { LocalApplicationDriverOptions } from "@draft-loop/application";
import {
  type ResearchSearchPort,
  readResearchSearchProvider,
  withBoundedResearchSources,
} from "@draft-loop/application/research-search";
import {
  type ClaudeSearchClient,
  type CredentialResolver,
  claudeSearchTokenPricing,
  createClaudeResearchSearch,
  createLinkupResearchSearch,
  directClaudeSearchClient,
  vertexClaudeSearchClient,
} from "@draft-loop/model-gateway";

import { WorkerConfigError } from "./config-error.js";
import type { WorkerModelRoutes } from "./route-config.js";

export interface ResearchSearchDependencies {
  /** A scripted Claude client, for tests. */
  readonly claudeClient?: () => Promise<ClaudeSearchClient>;
  /** A scripted transport for Linkup, for tests. */
  readonly fetch?: typeof fetch;
}

/**
 * The research search the deployment picked with `DRAFT_LOOP_RESEARCH_SEARCH` (#2560), or none.
 * `claude` searches on the deployment's own Claude route: Vertex AI in the EU, or the Claude API
 * on the direct routes. `linkup` reads its key as `linkup` from the deployment's key source. A
 * worker on fixtures, or with `off`, searches nothing.
 */
export function researchSearchFor(
  env: NodeJS.ProcessEnv,
  routes: WorkerModelRoutes | undefined,
  local: Pick<LocalApplicationDriverOptions, "resolveCredential">,
  dependencies: ResearchSearchDependencies = {},
): ResearchSearchPort | undefined {
  let provider: ReturnType<typeof readResearchSearchProvider>;
  try {
    provider = readResearchSearchProvider(env);
  } catch (error) {
    throw new WorkerConfigError((error as Error).message);
  }
  if (provider === "off" || routes === undefined) return undefined;
  // The routes' resolvers (key files, Secret Manager) take any provider name; a name with no key
  // configured, such as `linkup` on Secret Manager today, resolves to nothing.
  const resolveCredential: CredentialResolver =
    (local.resolveCredential as CredentialResolver | undefined) ?? (async () => undefined);
  if (provider === "linkup") {
    return withBoundedResearchSources(
      createLinkupResearchSearch({
        resolveCredential,
        ...(dependencies.fetch === undefined ? {} : { fetch: dependencies.fetch }),
      }),
    );
  }
  if (routes.kind === "direct") {
    return withBoundedResearchSources(
      createClaudeResearchSearch({
        route: "anthropic-api",
        clientFor: dependencies.claudeClient ?? directClaudeSearchClient(resolveCredential),
      }),
    );
  }
  const factor = routes.gateway.vertexPriceFactor;
  return withBoundedResearchSources(
    createClaudeResearchSearch({
      route: "vertex",
      clientFor:
        dependencies.claudeClient ??
        vertexClaudeSearchClient({
          projectId: routes.gateway.vertexProjectId,
          location: routes.gateway.vertexLocation,
        }),
      // Vertex AI's EU locations price tokens above the first-party rates.
      tokenPricing: {
        inputUsdPerMillion: claudeSearchTokenPricing.inputUsdPerMillion * factor,
        outputUsdPerMillion: claudeSearchTokenPricing.outputUsdPerMillion * factor,
      },
    }),
  );
}
