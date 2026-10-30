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

/**
 * A call's estimated worst cost before it is sent (#1985): its prompt size at the input rate,
 * plus its whole output budget at the output rate. Undefined when the model has no catalog price.
 */
export function worstCallCostUsd(request: ModelRequest<JsonObject>): number | undefined {
  const pricing = catalogModelPricing(request.model);
  if (pricing === undefined) return undefined;
  const promptCharacters =
    request.systemPrompt.length +
    JSON.stringify(request.input).length +
    JSON.stringify(request.outputSchema).length;
  const inputTokens = Math.ceil(promptCharacters / estimateCharactersPerToken);
  const outputTokens = request.maxOutputTokens ?? defaultMaxOutputTokens;
  return (
    (inputTokens * pricing.inputUsdPerMillionTokens +
      outputTokens * pricing.outputUsdPerMillionTokens) /
    1_000_000
  );
}

/**
 * Refuses, before it is sent, any call whose worst cost would pass what the run may still spend,
 * counting the calls this adapter already made. A model without a catalog price passes: the run's
 * own check stops it after that call, since its cost cannot be counted.
 */
export function guardCallCost<Executor extends ModelExecutor>(
  adapter: Executor,
  remainingCostUsd: number | undefined,
): ModelExecutor {
  if (remainingCostUsd === undefined) return adapter;
  let remaining = remainingCostUsd;
  return {
    execute: async (request) => {
      const worst = worstCallCostUsd(request);
      if (worst !== undefined && worst > remaining) throw new CallCostBudgetError(worst, remaining);
      const response = await adapter.execute(request);
      remaining -= response.cost.estimatedUsd ?? 0;
      return response;
    },
  };
}
