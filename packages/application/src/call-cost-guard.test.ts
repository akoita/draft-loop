import type { ModelSelection } from "@draft-loop/domain";
import { CallCostBudgetError } from "@draft-loop/orchestrator";
import type { JsonObject, ModelRequest, ModelResponse } from "@draft-loop/providers";
import { describe, expect, it, vi } from "vitest";
import { guardCallCost, worstCallCostUsd } from "./call-cost-guard.js";
import { defaultModelProfileRegistry } from "./model-profiles.js";

const opusCritic = defaultModelProfileRegistry.resolve("standard-anthropic-critic", 1, "critic");

function modelRequest(model: Partial<ModelSelection> = {}): ModelRequest<JsonObject> {
  return {
    runId: "run-1",
    executionId: "run-1:1:critic",
    contextSnapshotId: "context-1",
    model: {
      company: opusCritic.provider,
      modelId: opusCritic.modelId,
      role: "critic",
      promptTemplateVersion: "cli-critic-v6",
      profile: opusCritic,
      ...model,
    } as ModelSelection,
    // 2,996 + 2 + 2 characters: 1,000 estimated input tokens.
    systemPrompt: "s".repeat(2996),
    input: {},
    outputSchema: {},
    outputName: "draft_critique",
    maxOutputTokens: 10_000,
    dataPolicy: {} as ModelRequest<JsonObject>["dataPolicy"],
  } as ModelRequest<JsonObject>;
}

function scriptedAdapter(estimatedUsd: number) {
  return {
    execute: vi.fn(
      async () => ({ output: {}, cost: { estimatedUsd } }) as unknown as ModelResponse<JsonObject>,
    ),
  };
}

describe("call cost guard", () => {
  it("estimates the prompt at the input rate and the whole output budget at the output rate", () => {
    // Opus 5.5: 1,000 × $4 + 10,000 × $20 per million tokens.
    expect(worstCallCostUsd(modelRequest())).toBeCloseTo(0.204, 10);
    expect(worstCallCostUsd(modelRequest({ company: "unknown", modelId: "unpriced" }))).toBe(
      undefined,
    );
  });

  it("never sends a call whose worst cost would pass the remaining budget", async () => {
    const adapter = scriptedAdapter(0.1);
    const guarded = guardCallCost(adapter, 0.2);

    const refused = await guarded.execute(modelRequest()).catch((error: unknown) => error);

    expect(adapter.execute).not.toHaveBeenCalled();
    expect(refused).toBeInstanceOf(CallCostBudgetError);
    expect(refused).toMatchObject({ estimatedUsd: expect.closeTo(0.204, 10), remainingUsd: 0.2 });
  });

  it("counts the calls already made against the remaining budget", async () => {
    const adapter = scriptedAdapter(0.2);
    const guarded = guardCallCost(adapter, 0.35);

    await guarded.execute(modelRequest());
    await expect(guarded.execute(modelRequest())).rejects.toBeInstanceOf(CallCostBudgetError);

    expect(adapter.execute).toHaveBeenCalledTimes(1);
  });

  it("leaves a run without a cost limit, and an unpriced model, to the run's own checks", async () => {
    const adapter = scriptedAdapter(1);

    expect(guardCallCost(adapter, undefined)).toBe(adapter);
    await guardCallCost(adapter, 0).execute(
      modelRequest({ company: "unknown", modelId: "unpriced" }),
    );

    expect(adapter.execute).toHaveBeenCalledTimes(1);
  });
});
