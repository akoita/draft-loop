import type { JsonObject, ModelResponse } from "@draft-loop/providers";
import { describe, expect, it } from "vitest";

import { withAddedUsage } from "./author-targeted-revision.js";
import { responseExecution } from "./response-execution.js";

function response(usage: ModelResponse<JsonObject>["usage"]): ModelResponse<JsonObject> {
  return {
    output: {},
    contextSnapshotId: "context",
    provider: "anthropic",
    company: "anthropic",
    route: "direct",
    modelId: "m",
    providerRequestId: null,
    structuredOutputSha256: "a".repeat(64),
    usage,
    cost: { estimatedUsd: 1 },
  } as unknown as ModelResponse<JsonObject>;
}

describe("response execution", () => {
  it("records the call's prompt-cache reads and writes when the provider reports them (#1986)", () => {
    const cached = responseExecution(
      response({
        inputTokens: 1_000,
        outputTokens: 10,
        totalTokens: 1_010,
        cachedInputTokens: 900,
        cacheWriteInputTokens: 50,
      }),
      {},
    );
    expect(cached.cachedInputTokens).toBe(900);
    expect(cached.cacheWriteInputTokens).toBe(50);

    const plain = responseExecution(
      response({ inputTokens: 1_000, outputTokens: 10, totalTokens: 1_010 }),
      {},
    );
    expect(plain).not.toHaveProperty("cachedInputTokens");
    expect(plain).not.toHaveProperty("cacheWriteInputTokens");
  });

  it("adds the cache counts of a patch attempt to the revision that followed it", () => {
    const added = withAddedUsage(
      response({ inputTokens: 100, outputTokens: 10, totalTokens: 110, cachedInputTokens: 90 }),
      response({
        inputTokens: 100,
        outputTokens: 5,
        totalTokens: 105,
        cachedInputTokens: 80,
        cacheWriteInputTokens: 10,
      }),
    );
    expect(added.usage).toEqual({
      inputTokens: 200,
      outputTokens: 15,
      totalTokens: 215,
      cachedInputTokens: 170,
      cacheWriteInputTokens: 10,
    });
    expect(added.cost.estimatedUsd).toBe(2);
  });
});
