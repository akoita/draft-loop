import type { AnthropicClient } from "@draft-loop/providers";
import { describe, expect, it, vi } from "vitest";

import {
  checkClaudeRefusalFallbackModel,
  claudeRefusalFallbackFor,
  claudeRefusalFallbackModel,
} from "./claude-refusal-fallback.js";
import { createDirectAnthropicRoute } from "./hosted-routes.js";
import { model, request } from "./vertex-test-support.js";

const pricing = { inputUsdPerMillionTokens: 3, outputUsdPerMillionTokens: 15 };
const setting = { modelId: "claude-sonnet-5", pricing };

const refused = {
  content: [],
  model: "claude-sonnet-5-5",
  stop_reason: "refusal",
  stop_details: { type: "refusal", category: "cyber", fallback_credit_token: "credit-1" },
  usage: { input_tokens: 1000, output_tokens: 0 },
};

const answered = {
  content: [{ type: "text", text: '{"answer":"yes"}' }],
  model: "claude-sonnet-5",
  stop_reason: "end_turn",
  usage: { input_tokens: 1000, output_tokens: 500 },
};

function scripted(...responses: readonly unknown[]) {
  const queue = [...responses];
  const create = vi.fn((_parameters: unknown, _options?: unknown) => {
    const data = queue.shift();
    return { withResponse: async () => ({ data, request_id: "request-1" }) } as never;
  });
  return { client: { messages: { create } } as AnthropicClient, create };
}

describe("the deployment's refusal fallback model", () => {
  it("accepts an author's allowed Haiku or Sonnet fallback with known rates", () => {
    expect(checkClaudeRefusalFallbackModel("claude-sonnet-5", pricing)).toBe(pricing);
    expect(claudeRefusalFallbackModel("claude-sonnet-5-5")).toBe("claude-sonnet-5");
    expect(claudeRefusalFallbackModel("claude-haiku-5-5")).toBeUndefined();
    expect(claudeRefusalFallbackModel("constructor")).toBeUndefined();
  });

  it.each([
    ["gpt-6-luna", "not a Claude Haiku or Sonnet model"],
    ["claude-opus-5-5", "not a Claude Haiku or Sonnet model"],
    ["claude-haiku-5-5", "claude-sonnet-5-5 falls back to claude-sonnet-5"],
  ])("refuses %s", (modelId, message) => {
    expect(() => checkClaudeRefusalFallbackModel(modelId, pricing)).toThrow(message);
  });

  it("refuses a fallback without known rates", () => {
    expect(() => checkClaudeRefusalFallbackModel("claude-sonnet-5", undefined)).toThrow(
      "no known rates",
    );
  });

  it("applies only to a call whose model falls back to it", () => {
    expect(claudeRefusalFallbackFor(setting, model)).toEqual(setting);
    expect(
      claudeRefusalFallbackFor(setting, { ...model, modelId: "claude-haiku-5-5" }),
    ).toBeUndefined();
    expect(claudeRefusalFallbackFor(undefined, model)).toBeUndefined();
  });
});

describe("the direct Claude route with a refusal fallback", () => {
  it("retries a refused call once on the fallback and records it", async () => {
    const { client, create } = scripted(refused, answered);
    const route = createDirectAnthropicRoute({
      resolveCredential: async () => "synthetic-claude-key",
      anthropicApiClient: () => client,
      refusalFallback: setting,
    })({ configuredModel: model, pricing, retry: { maxRetries: 0 } });

    const response = await route.execute(request);

    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1]?.[0]).toMatchObject({ model: "claude-sonnet-5" });
    expect(response).toMatchObject({
      modelId: "claude-sonnet-5",
      route: "anthropic-api",
      refusalFallback: { fromModel: "claude-sonnet-5-5", category: "cyber", credit: true },
    });
  });

  it("does not retry when the switch says no", async () => {
    const { client, create } = scripted(refused);
    const route = createDirectAnthropicRoute({
      resolveCredential: async () => "synthetic-claude-key",
      anthropicApiClient: () => client,
      refusalFallback: { ...setting, allowed: async () => false },
    })({ configuredModel: model, pricing, retry: { maxRetries: 0 } });

    await expect(route.execute(request)).rejects.toMatchObject({ retryable: false });
    expect(create).toHaveBeenCalledOnce();
  });

  it("keeps a single call without the setting", async () => {
    const { client, create } = scripted(refused);
    const route = createDirectAnthropicRoute({
      resolveCredential: async () => "synthetic-claude-key",
      anthropicApiClient: () => client,
    })({ configuredModel: model, pricing, retry: { maxRetries: 0 } });

    await expect(route.execute(request)).rejects.toMatchObject({ retryable: false });
    expect(create).toHaveBeenCalledOnce();
  });
});
