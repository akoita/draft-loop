import type { AgentExecution } from "@draft-loop/orchestrator";
import type { JsonObject, ModelResponse } from "@draft-loop/providers";

export function responseExecution<T>(
  response: ModelResponse<JsonObject>,
  output: T,
): AgentExecution<T> {
  return {
    output,
    provider: response.provider,
    route: response.route,
    ...(response.routeFallback === undefined ? {} : { routeFallback: response.routeFallback }),
    modelId: response.modelId,
    providerRequestId: response.providerRequestId,
    outputChecksum: response.structuredOutputSha256,
    inputTokens: response.usage.inputTokens,
    outputTokens: response.usage.outputTokens,
    totalTokens: response.usage.totalTokens,
    // Cache reads and writes let a run's record show what its calls read back (#1986).
    ...(response.usage.cachedInputTokens === undefined
      ? {}
      : { cachedInputTokens: response.usage.cachedInputTokens }),
    ...(response.usage.cacheWriteInputTokens === undefined
      ? {}
      : { cacheWriteInputTokens: response.usage.cacheWriteInputTokens }),
    estimatedUsd: response.cost.estimatedUsd,
    completedAt: timestamp(),
  };
}

export const timestamp = (): string => new Date().toISOString();
