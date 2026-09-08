import type { AgentExecution } from "@draft-loop/orchestrator";
import type { JsonObject, ModelResponse } from "@draft-loop/providers";

export function responseExecution<T>(
  response: ModelResponse<JsonObject>,
  output: T,
): AgentExecution<T> {
  return {
    output,
    provider: response.provider,
    modelId: response.modelId,
    providerRequestId: response.providerRequestId,
    outputChecksum: response.structuredOutputSha256,
    inputTokens: response.usage.inputTokens,
    outputTokens: response.usage.outputTokens,
    totalTokens: response.usage.totalTokens,
    estimatedUsd: response.cost.estimatedUsd,
    completedAt: new Date().toISOString(),
  };
}
