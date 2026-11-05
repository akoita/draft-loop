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

  it("prices the prefix a declared prompt cache serves at the cache-read rate", () => {
    // Opus 5.5 cache read: $0.20 per million tokens. The system prompt and the first two input
    // members (3,000 characters: 1,000 tokens) are the cached prefix; the third member and the
    // output schema (3,000 characters) are not.
    const request: ModelRequest<JsonObject> = {
      ...modelRequest(),
      systemPrompt: "s".repeat(2975),
      input: { a: "a".repeat(5), b: "b".repeat(5), c: "c".repeat(2991) },
      promptCache: {
        systemPrompt: "s".repeat(2975),
        callInstructions: "",
        stableInputMembers: 2,
      },
    };

    // 1,000 × $0.20 + 1,000 × $4 + 10,000 × $20 per million tokens.
    expect(worstCallCostUsd(request)).toBeCloseTo(0.2042, 10);
    // A layout that names more stable members than the input has caches nothing.
    expect(
      worstCallCostUsd({
        ...request,
        promptCache: { ...request.promptCache, stableInputMembers: 4 } as never,
      }),
    ).toBeCloseTo(0.208, 10);
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
  describe("calls in flight together (#2233)", () => {
    /** An adapter whose calls stay open until released, billing `estimatedUsd` each. */
    function gatedAdapter(estimatedUsd: number, fail = false) {
      const releases: (() => void)[] = [];
      let running = 0;
      let peak = 0;
      const execute = vi.fn(async () => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise<void>((resolve) => releases.push(resolve));
        running -= 1;
        if (fail) throw new Error("provider failed");
        return { output: {}, cost: { estimatedUsd } } as unknown as ModelResponse<JsonObject>;
      });
      const drain = async () => {
        for (let turn = 0; turn < 50; turn += 1) {
          releases.shift()?.();
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      };
      return { execute, drain, peak: () => peak };
    }

    it("reserves each call's worst cost, and a call that does not fit waits instead of failing", async () => {
      // Worst cost 0.204 each: two fit in 0.5 at once; the third waits for one to bill 0.05.
      const adapter = gatedAdapter(0.05);
      const guarded = guardCallCost(adapter, 0.5);
      const calls = Promise.all([1, 2, 3].map(() => guarded.execute(modelRequest())));
      await adapter.drain();
      await expect(calls).resolves.toHaveLength(3);
      expect(adapter.peak()).toBe(2);
      expect(adapter.execute).toHaveBeenCalledTimes(3);
    });

    it("still refuses a call that would not fit once every call in flight has billed", async () => {
      const adapter = gatedAdapter(0.2);
      const guarded = guardCallCost(adapter, 0.45);
      const calls = Promise.allSettled([1, 2, 3].map(() => guarded.execute(modelRequest())));
      await adapter.drain();
      const outcomes = await calls;
      expect(outcomes.map(({ status }) => status)).toEqual(["fulfilled", "fulfilled", "rejected"]);
      expect((outcomes[2] as PromiseRejectedResult).reason).toBeInstanceOf(CallCostBudgetError);
    });

    it("releases the reservation of a call that fails", async () => {
      const failing = gatedAdapter(0, true);
      const guarded = guardCallCost(failing, 0.3);
      const first = guarded.execute(modelRequest()).catch((error: unknown) => error);
      await failing.drain();
      expect(await first).toBeInstanceOf(Error);
      const second = guarded.execute(modelRequest()).catch((error: unknown) => error);
      await failing.drain();
      expect(failing.execute).toHaveBeenCalledTimes(2);
      expect(await second).not.toBeInstanceOf(CallCostBudgetError);
    });
  });
});
