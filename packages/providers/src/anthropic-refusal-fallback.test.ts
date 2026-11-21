import type { ModelSelection } from "@draft-loop/domain";
import { describe, expect, it, vi } from "vitest";

import {
  AnthropicAdapter,
  type AnthropicClient,
  anthropicRefusal,
  fallbackCreditBeta,
  type ModelRequest,
} from "./index.js";

const model: ModelSelection = {
  company: "anthropic",
  modelId: "claude-sonnet-5-5",
  role: "author",
  promptTemplateVersion: "author-v1",
};

const schema = {
  type: "object",
  properties: { answer: { type: "string" } },
  required: ["answer"],
  additionalProperties: false,
} as const;

function request(overrides: Partial<ModelRequest> = {}): ModelRequest {
  return {
    contextSnapshotId: "snapshot-1",
    model,
    systemPrompt: "Return the requested data as JSON.",
    input: { question: "What is the answer?" },
    outputSchema: schema,
    outputName: "answer_schema",
    dataPolicy: {
      allowTransmission: true,
      allowedCompanies: ["anthropic", "openai"],
      sensitiveData: false,
      sensitiveDataAcknowledged: false,
    },
    ...overrides,
  };
}

const refused = (token: string | null) => ({
  content: [],
  model: "claude-sonnet-5-5",
  stop_reason: "refusal",
  stop_details: {
    type: "refusal",
    category: "cyber",
    explanation: "Synthetic explanation that must not be recorded.",
    fallback_credit_token: token,
    fallback_has_prefill_claim: false,
  },
  usage: { input_tokens: 1_000_000, output_tokens: 0 },
});

const answered = {
  content: [{ type: "text", text: '{"answer":"yes"}' }],
  model: "claude-sonnet-5",
  stop_reason: "end_turn",
  usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 },
};

function scripted(...responses: readonly unknown[]) {
  const queue = [...responses];
  const create = vi.fn((_parameters: unknown, _options?: unknown) => {
    const data = queue.shift();
    return { withResponse: async () => ({ data, request_id: `request-${queue.length}` }) } as never;
  });
  const client: AnthropicClient = { messages: { create } };
  return { client, create };
}

const fallback = {
  modelId: "claude-sonnet-5",
  pricing: { inputUsdPerMillionTokens: 3, outputUsdPerMillionTokens: 15 },
};
const pricing = { inputUsdPerMillionTokens: 2, outputUsdPerMillionTokens: 10 };

describe("Claude refusal fallback", () => {
  it("retries a refusal once on the fallback model with the same body and the credit", async () => {
    const { client, create } = scripted(refused("credit-1"), answered);
    const adapter = new AnthropicAdapter(client, {
      configuredModel: model,
      pricing,
      refusalFallback: fallback,
    });

    const response = await adapter.execute(request());

    expect(create).toHaveBeenCalledTimes(2);
    const [first, firstOptions] = create.mock.calls[0] as [Record<string, unknown>, unknown];
    const [second, secondOptions] = create.mock.calls[1] as [Record<string, unknown>, unknown];
    const { model: firstModel, ...firstBody } = first;
    const { model: secondModel, fallback_credit_token: credit, ...secondBody } = second;
    expect([firstModel, secondModel]).toEqual(["claude-sonnet-5-5", "claude-sonnet-5"]);
    expect(secondBody).toEqual(firstBody);
    expect(credit).toEqual({ token: "credit-1", mode: "best_effort" });
    for (const options of [firstOptions, secondOptions]) {
      expect(options).toEqual({ headers: { "anthropic-beta": fallbackCreditBeta } });
    }
    expect(response).toMatchObject({
      output: { answer: "yes" },
      modelId: "claude-sonnet-5",
      refusalFallback: { fromModel: "claude-sonnet-5-5", category: "cyber", credit: true },
    });
    expect(JSON.stringify(response)).not.toContain("Synthetic explanation");
  });

  it("counts both calls' tokens and cost, each at its own model's rates", async () => {
    const { client } = scripted(refused("credit-1"), answered);
    const adapter = new AnthropicAdapter(client, {
      configuredModel: model,
      pricing,
      refusalFallback: fallback,
    });

    const response = await adapter.execute(request());

    expect(response.usage).toMatchObject({ inputTokens: 2_000_000, outputTokens: 1_000_000 });
    // Refused call: 1M input at $2. Fallback: 1M input at $3 plus 1M output at $15.
    expect(response.cost.estimatedUsd).toBeCloseTo(20, 10);
  });

  it("retries without a credit when the refusal carries none", async () => {
    const { client, create } = scripted(refused(null), answered);
    const adapter = new AnthropicAdapter(client, {
      configuredModel: model,
      pricing,
      refusalFallback: fallback,
    });

    const response = await adapter.execute(request());

    expect(create.mock.calls[1]?.[0]).not.toHaveProperty("fallback_credit_token");
    expect(response.refusalFallback).toEqual({
      fromModel: "claude-sonnet-5-5",
      category: "cyber",
      credit: false,
    });
  });

  it("does not retry when the kill switch or a cap says no, and keeps the refusal's category", async () => {
    const { client, create } = scripted(refused("credit-1"));
    const allowed = vi.fn(() => false);
    const adapter = new AnthropicAdapter(client, {
      configuredModel: model,
      pricing,
      refusalFallback: { ...fallback, allowed },
    });

    const error = await adapter.execute(request()).catch((value: unknown) => value);

    expect(allowed).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledOnce();
    expect(error).toMatchObject({
      code: "invalid-response",
      retryable: false,
      message: "Claude declined the request.",
      diagnostics: [
        { code: "refusal", path: "stop_reason" },
        { code: "refusal_category_cyber", path: "stop_details.category" },
      ],
      billed: { cost: { estimatedUsd: 2 } },
    });
  });

  it("retries only once: a refusing fallback fails the step and says so", async () => {
    const { client, create } = scripted(refused("credit-1"), refused("credit-2"));
    const adapter = new AnthropicAdapter(client, {
      configuredModel: model,
      pricing,
      refusalFallback: fallback,
    });

    await expect(adapter.execute(request())).rejects.toMatchObject({
      retryable: false,
      diagnostics: expect.arrayContaining([
        { code: "refusal_fallback_refused", path: "stop_reason" },
      ]),
    });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("keeps the old behaviour without a fallback: no beta header and one call", async () => {
    const { client, create } = scripted(refused("credit-1"));
    const adapter = new AnthropicAdapter(client, { configuredModel: model, pricing });

    await expect(adapter.execute(request())).rejects.toMatchObject({ retryable: false });
    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0]?.[1]).toEqual({});
  });

  it("reads only safe category tokens and ignores responses that did not refuse", () => {
    expect(anthropicRefusal(answered)).toBeUndefined();
    expect(
      anthropicRefusal({ stop_reason: "refusal", stop_details: { category: "Free text!" } }),
    ).toEqual({ category: null, creditToken: null });
  });
});
