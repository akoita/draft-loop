import type { ModelSelection } from "@draft-loop/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AnthropicAdapter,
  type AnthropicClient,
  type ModelRequest,
  type ModelResponse,
  type PromptCacheLayout,
} from "./index.js";

type Params = Parameters<AnthropicClient["messages"]["create"]>[0];

const model: ModelSelection = {
  company: "anthropic",
  modelId: "claude-test-exact",
  role: "author",
  promptTemplateVersion: "author-v1",
};

const promptCache: PromptCacheLayout = {
  systemPrompt: "Write the CV.",
  callInstructions: " Draft it.",
  stableInputMembers: 2,
  lifetime: "5m",
};

const pricing = {
  inputUsdPerMillionTokens: 4,
  outputUsdPerMillionTokens: 20,
  cachedInputUsdPerMillionTokens: 0.2,
  cacheWriteInputUsdPerMillionTokens: 5,
};

function request(layout: PromptCacheLayout | null = promptCache): ModelRequest {
  return {
    contextSnapshotId: "snapshot-1",
    model,
    systemPrompt: "Write the CV. Draft it.",
    input: { context: { role: "Platform engineer" }, retrievedEvidence: [{ id: "e1" }], round: 1 },
    ...(layout === null ? {} : { promptCache: layout }),
    outputSchema: {
      type: "object",
      properties: { answer: { type: "string" } },
      required: ["answer"],
      additionalProperties: false,
    },
    outputName: "answer",
    dataPolicy: {
      allowTransmission: true,
      allowedCompanies: ["anthropic"],
      sensitiveData: false,
      sensitiveDataAcknowledged: false,
    },
  };
}

function message(usage: Record<string, number>, stopReason = "end_turn") {
  return {
    id: "msg",
    content: [{ type: "text", text: '{"answer":"yes"}' }],
    model: model.modelId,
    stop_reason: stopReason,
    usage,
  };
}

const fullUsage = { input_tokens: 10, output_tokens: 100, cache_creation_input_tokens: 1000 };
const keepAliveUsage = { input_tokens: 10, output_tokens: 1, cache_read_input_tokens: 1000 };

/** A client whose full request takes `durationMs` and whose one-token copies answer at once. */
function client(
  durationMs: number,
  keepAlive: () => Promise<unknown> = async () => message(keepAliveUsage, "max_tokens"),
) {
  const calls: { readonly params: Params; readonly atMs: number }[] = [];
  const start = Date.now();
  const anthropic: AnthropicClient = {
    messages: {
      create: (params: Params) => {
        calls.push({ params, atMs: Date.now() - start });
        const promise =
          params.max_tokens === 1
            ? keepAlive()
            : new Promise((resolve) => setTimeout(() => resolve(message(fullUsage)), durationMs));
        return Object.assign(promise, {
          withResponse: async () => ({
            data: await promise,
            request_id: `request-${calls.length}`,
          }),
        }) as ReturnType<AnthropicClient["messages"]["create"]>;
      },
    },
  };
  return { anthropic, calls };
}

async function run(adapter: AnthropicAdapter, durationMs: number, sent: ModelRequest = request()) {
  const pending = adapter.execute(sent);
  await vi.advanceTimersByTimeAsync(durationMs);
  return pending;
}

describe("Anthropic prompt-cache keep-alive (#2043)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends a one-token copy of a five-minute cached request every 3.5 minutes while it runs", async () => {
    const { anthropic, calls } = client(8 * 60_000);
    const adapter = new AnthropicAdapter(anthropic, { configuredModel: model, pricing });

    const response = await run(adapter, 8 * 60_000);

    expect(calls.map((call) => [call.params.max_tokens, call.atMs])).toEqual([
      [4096, 0],
      [1, 210_000],
      [1, 420_000],
    ]);
    const [full, ...copies] = calls;
    for (const copy of copies) {
      expect(copy.params).toEqual({ ...full?.params, max_tokens: 1 });
    }
    expect(response.usage).toEqual({
      inputTokens: 1010 + 2 * 1010,
      outputTokens: 102,
      totalTokens: 3030 + 102,
      cachedInputTokens: 2000,
      cacheWriteInputTokens: 1000,
    });
    expect(response.cost.estimatedUsd).toBeCloseTo(
      (10 * 4 + 1000 * 5 + 100 * 20 + 2 * (10 * 4 + 1000 * 0.2 + 1 * 20)) / 1_000_000,
      9,
    );
  });

  it("sends none when the request completes before the first interval", async () => {
    const { anthropic, calls } = client(60_000);
    const adapter = new AnthropicAdapter(anthropic, { configuredModel: model, pricing });

    const response = await run(adapter, 60_000);

    expect(calls).toHaveLength(1);
    expect(response.usage.cachedInputTokens).toBeUndefined();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(calls).toHaveLength(1);
  });

  it("sends none for a one-hour prefix, an uncached request or budgeted thinking", async () => {
    for (const layout of [{ ...promptCache, lifetime: "1h" as const }, null]) {
      const { anthropic, calls } = client(8 * 60_000);
      const adapter = new AnthropicAdapter(anthropic, { configuredModel: model, pricing });
      await run(adapter, 8 * 60_000, request(layout));
      expect(calls).toHaveLength(1);
    }
    const budgeted: ModelSelection = {
      ...model,
      profile: {
        id: "budgeted-author",
        version: 1,
        provider: "anthropic",
        modelId: model.modelId,
        tier: "economy",
        roles: ["author"],
        runtime: {
          effort: "provider-default",
          maxOutputTokens: 8192,
          thinking: { mode: "budgeted", maxTokens: 2048 },
        },
        knownLimits: { maxOutputTokens: 64000, contextWindowTokens: 200000 },
      },
    };
    const { anthropic, calls } = client(8 * 60_000);
    const adapter = new AnthropicAdapter(anthropic, { configuredModel: budgeted, pricing });
    await run(adapter, 8 * 60_000, { ...request(), model: budgeted, maxOutputTokens: 8192 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.params.thinking).toEqual({ type: "enabled", budget_tokens: 2048 });
  });

  it("ignores a failed keep-alive and keeps the ones that were billed", async () => {
    let attempts = 0;
    const { anthropic, calls } = client(8 * 60_000, async () => {
      attempts += 1;
      if (attempts === 1) throw Object.assign(new Error("overloaded"), { status: 529 });
      return message(keepAliveUsage, "max_tokens");
    });
    const adapter = new AnthropicAdapter(anthropic, { configuredModel: model, pricing });

    const response = await run(adapter, 8 * 60_000);

    expect(calls).toHaveLength(3);
    expect(response.usage.cachedInputTokens).toBe(1000);
  });

  it("counts the keep-alives of a failed attempt in its billed usage", async () => {
    const { anthropic, calls } = client(8 * 60_000);
    anthropic.messages.create = ((params: Params) => {
      calls.push({ params, atMs: Date.now() });
      const promise =
        params.max_tokens === 1
          ? Promise.resolve(message(keepAliveUsage, "max_tokens"))
          : new Promise((resolve) =>
              setTimeout(() => resolve(message(fullUsage, "max_tokens")), 4 * 60_000),
            );
      return Object.assign(promise, {
        withResponse: async () => ({ data: await promise, request_id: null }),
      }) as ReturnType<AnthropicClient["messages"]["create"]>;
    }) as AnthropicClient["messages"]["create"];
    const adapter = new AnthropicAdapter(anthropic, {
      configuredModel: model,
      pricing,
      retry: { maxRetries: 0 },
    });

    const pending = adapter.execute(request()).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    const failure = await pending;

    expect(calls).toHaveLength(2);
    expect(
      (failure as { billed?: ModelResponse["usage"] & { usage: ModelResponse["usage"] } }).billed
        ?.usage.cachedInputTokens,
    ).toBe(1000);
  });

  it("takes its interval from the adapter options", async () => {
    const { anthropic, calls } = client(5 * 60_000);
    const adapter = new AnthropicAdapter(anthropic, {
      configuredModel: model,
      pricing,
      cacheKeepAliveIntervalMs: 60_000,
    });

    await run(adapter, 5 * 60_000);

    expect(calls.filter((call) => call.params.max_tokens === 1)).toHaveLength(4);
  });
});
