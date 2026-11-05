import { CallCostBudgetError } from "@draft-loop/orchestrator";
import type { JsonObject, ModelRequest, ModelResponse } from "@draft-loop/providers";
import { catalogModelPricing } from "./provider-model-pricing.js";

/**
 * Fewer characters per token than prose averages, so the estimate leans high: JSON evidence and
 * French text both tokenize denser than English prose.
 */
const estimateCharactersPerToken = 3;
/** The output budget a provider adapter applies when a request names none. */
const defaultMaxOutputTokens = 4096;

interface ModelExecutor {
  readonly execute: (request: ModelRequest<JsonObject>) => Promise<ModelResponse<JsonObject>>;
}

/** The characters of the prefix a provider's prompt cache serves, when the request declares one. */
function cachedPrefixCharacters(request: ModelRequest<JsonObject>): number {
  const layout = request.promptCache;
  if (layout === undefined) return 0;
  const members = Object.entries(request.input);
  if (layout.stableInputMembers < 1 || layout.stableInputMembers > members.length) return 0;
  const stable = Object.fromEntries(members.slice(0, layout.stableInputMembers));
  return layout.systemPrompt.length + JSON.stringify(stable).length;
}

/**
 * A call's estimated worst cost before it is sent (#1985): its prompt size at the input rate,
 * plus its whole output budget at the output rate. Undefined when the model has no catalog price.
 *
 * The prefix a declared prompt cache serves is priced at the cache-read rate instead: the run's
 * first call of that role writes it, so pricing it at the input rate on every later call refused
 * calls the run could afford (the critique's retry on the 2026-11-01 run of private reference G,
 * estimated at $0.81 with $0.45 left and a cached career source). A write of an expired cache
 * costs more than this estimate; the run's cost limit, checked after each call, still stops it
 * (#2028).
 */
export function worstCallCostUsd(request: ModelRequest<JsonObject>): number | undefined {
  const pricing = catalogModelPricing(request.model);
  if (pricing === undefined) return undefined;
  const promptCharacters =
    request.systemPrompt.length +
    JSON.stringify(request.input).length +
    JSON.stringify(request.outputSchema).length;
  const cachedCharacters = Math.min(cachedPrefixCharacters(request), promptCharacters);
  const cachedTokens = Math.ceil(cachedCharacters / estimateCharactersPerToken);
  const inputTokens = Math.ceil((promptCharacters - cachedCharacters) / estimateCharactersPerToken);
  const outputTokens = request.maxOutputTokens ?? defaultMaxOutputTokens;
  return (
    (cachedTokens * (pricing.cachedInputUsdPerMillionTokens ?? pricing.inputUsdPerMillionTokens) +
      inputTokens * pricing.inputUsdPerMillionTokens +
      outputTokens * pricing.outputUsdPerMillionTokens) /
    1_000_000
  );
}

/**
 * Refuses, before it is sent, any call whose worst cost would pass what the run may still spend,
 * counting the calls this adapter already made. A model without a catalog price passes: the run's
 * own check stops it after that call, since its cost cannot be counted.
 *
 * Each call reserves its worst cost while it is in flight and settles to its billed cost when it
 * answers, so calls sent together cannot each spend the same remainder (#2233). A call that fails
 * releases its reservation, as a sequential failure counted nothing. A call that does not fit while
 * others are in flight waits for them to settle and is priced again, so running calls together
 * never refuses a call that running them one by one would have sent.
 */
export function guardCallCost<Executor extends ModelExecutor>(
  adapter: Executor,
  remainingCostUsd: number | undefined,
): ModelExecutor {
  if (remainingCostUsd === undefined) return adapter;
  let remaining = remainingCostUsd;
  const inFlight = new Set<Promise<void>>();
  return {
    execute: async (request) => {
      const worst = worstCallCostUsd(request);
      // A call that only fits once the calls in flight settle waits for them instead of failing.
      while (worst !== undefined && worst > remaining && inFlight.size > 0) {
        await Promise.race(inFlight);
      }
      if (worst !== undefined && worst > remaining) throw new CallCostBudgetError(worst, remaining);
      const reserved = worst ?? 0;
      remaining -= reserved;
      const call = adapter.execute(request);
      const settled = call.then(
        () => undefined,
        () => undefined,
      );
      inFlight.add(settled);
      try {
        const response = await call;
        remaining += reserved - (response.cost.estimatedUsd ?? 0);
        return response;
      } catch (error) {
        remaining += reserved;
        throw error;
      } finally {
        inFlight.delete(settled);
      }
    },
  };
}
