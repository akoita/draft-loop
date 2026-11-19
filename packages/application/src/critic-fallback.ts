import type {
  AgentExecution,
  CriticAgent,
  CriticFallbackRecord,
  CriticRequest,
  Critique,
} from "@draft-loop/orchestrator";

/**
 * Provider errors the run cannot wait out (#3122): a revoked or refused key, an exhausted quota, a
 * provider policy refusal, or a transient failure the adapter already retried.
 */
export const criticFallbackErrorClasses: ReadonlySet<string> = new Set([
  "authentication",
  "permission",
  "quota-exhausted",
  "policy",
  "transient",
]);

export interface CriticFallbackOptions {
  /** The run's configured critic. */
  readonly primary: CriticAgent;
  readonly primaryProvider: string;
  readonly primaryModel: string;
  /**
   * The fallback critic, or undefined when none may be used: no fallback is configured, or the
   * candidate's consent does not cover the fallback's company. Read once, on the first failure.
   */
  readonly fallback: () => CriticAgent | undefined | Promise<CriticAgent | undefined>;
}

/**
 * The deployment's fallback critic for one run (#3131): its company and model, and whether the
 * candidate's recorded consent covers that company, read once on the first failure.
 */
export interface RunCriticFallback {
  readonly company: string;
  readonly modelId: string;
  readonly permitted: () => Promise<boolean>;
}

function errorClass(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as { readonly code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/**
 * The run's critic, switching once to a fallback critic after a provider error the run cannot
 * wait out. Every later critic call in the run goes to the fallback, and each of its executions
 * carries a `criticFallback` record naming the critic it replaced, the error class and the round
 * of the first failure. Any other error, or a failure without a usable fallback, is thrown as is.
 */
export function withCriticFallback(options: CriticFallbackOptions): CriticAgent {
  let switched: { readonly agent: CriticAgent; readonly record: CriticFallbackRecord } | undefined;
  let refused = false;

  const onFallback = async (request: CriticRequest): Promise<AgentExecution<Critique>> => {
    if (switched === undefined) throw new Error("No fallback critic.");
    const execution = await switched.agent.execute(request);
    return { ...execution, criticFallback: switched.record };
  };

  return {
    execute: async (request) => {
      if (switched !== undefined) return onFallback(request);
      try {
        return await options.primary.execute(request);
      } catch (error) {
        const cause = errorClass(error);
        if (refused || cause === undefined || !criticFallbackErrorClasses.has(cause)) throw error;
        if (request.signal?.aborted === true) throw error;
        const agent = await options.fallback();
        if (agent === undefined) {
          refused = true;
          throw error;
        }
        switched = {
          agent,
          record: {
            fromProvider: options.primaryProvider,
            fromModel: options.primaryModel,
            errorClass: cause,
            round: request.round,
          },
        };
        return onFallback(request);
      }
    },
  };
}

/**
 * The run's critic from its factory, wrapped with the run's fallback when the deployment names
 * one and it is a different critic; otherwise the configured critic alone.
 */
export function runCriticWithFallback(
  identity: { readonly company: string; readonly modelId: string },
  fallback: RunCriticFallback | undefined,
  criticFor: (company: string, modelId: string) => CriticAgent,
): CriticAgent {
  const primary = criticFor(identity.company, identity.modelId);
  if (
    fallback === undefined ||
    (fallback.company === identity.company && fallback.modelId === identity.modelId)
  ) {
    return primary;
  }
  return withCriticFallback({
    primary,
    primaryProvider: identity.company,
    primaryModel: identity.modelId,
    fallback: async () =>
      (await fallback.permitted()) ? criticFor(fallback.company, fallback.modelId) : undefined,
  });
}
