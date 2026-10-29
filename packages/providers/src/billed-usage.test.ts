import type { ModelSelection } from "@draft-loop/domain";
import { describe, expect, it } from "vitest";

import { addBilledUsage } from "./billed-usage.js";
import {
  AnthropicAdapter,
  type AnthropicClient,
  type ModelRequest,
  OpenAIAdapter,
  type OpenAIClient,
  ProviderAdapterError,
  withBilledUsage,
} from "./index.js";

const model: ModelSelection = {
  company: "anthropic",
  modelId: "claude-test-exact",
  role: "author",
  promptTemplateVersion: "author-v1",
};

const pricing = { inputUsdPerMillionTokens: 1, outputUsdPerMillionTokens: 2 };

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

function anthropicClient(responses: readonly unknown[]): AnthropicClient {
  let index = 0;
  return {
    messages: {
      create: () =>
        ({
          withResponse: async () => ({ data: responses[index++], request_id: null }),
        }) as never,
    },
  };
}

describe("billed usage of rejected responses (#1967)", () => {
  it("carries the usage and cost of an Anthropic response stopped at its output cap", async () => {
    const adapter = new AnthropicAdapter(
      anthropicClient([
        {
          content: [{ type: "text", text: '{"answer":' }],
          stop_reason: "max_tokens",
          usage: { input_tokens: 1_000, output_tokens: 32_768 },
        },
      ]),
      { configuredModel: model, pricing },
    );

    const error = (await adapter.execute(request()).catch((value: unknown) => value)) as
      | ProviderAdapterError
      | undefined;

    expect(error).toBeInstanceOf(ProviderAdapterError);
    expect(error?.diagnostics).toEqual([{ code: "max_tokens", path: "stop_reason" }]);
    expect(error?.billed).toEqual({
      usage: { inputTokens: 1_000, outputTokens: 32_768, totalTokens: 33_768 },
      cost: { estimatedUsd: expect.closeTo(0.066536, 9) },
    });
    expect(error?.metadata.billed).toEqual(error?.billed);
  });

  it("adds a retried Anthropic attempt's usage to the response that succeeds", async () => {
    const outputSchemas = { answer_schema: schema, other: schema };
    const usage = { input_tokens: 100, output_tokens: 10 };
    const adapter = new AnthropicAdapter(
      anthropicClient([
        // The first answer fills another call's member, so its output is missing and retried.
        {
          content: [{ type: "text", text: '{"output":{"other":{"answer":"no"}}}' }],
          stop_reason: "end_turn",
          usage,
        },
        {
          content: [{ type: "text", text: '{"output":{"answer_schema":{"answer":"yes"}}}' }],
          stop_reason: "end_turn",
          usage,
        },
      ]),
      { configuredModel: model, pricing, retry: { sleep: async () => undefined } },
    );

    const response = await adapter.execute(
      request({
        input: { stable: "context", question: "What is the answer?" },
        promptCache: {
          systemPrompt: "Return the requested data as JSON.",
          callInstructions: "",
          stableInputMembers: 1,
          outputSchemas,
        },
      }),
    );

    expect(response.output).toEqual({ answer: "yes" });
    expect(response.usage).toEqual({ inputTokens: 200, outputTokens: 20, totalTokens: 220 });
    expect(response.cost.estimatedUsd).toBeCloseTo(0.00024, 9);
  });

  it("carries the usage of an OpenAI response whose output is not JSON", async () => {
    const client: OpenAIClient = {
      responses: {
        create: async () =>
          ({
            output_text: '{"answer":',
            usage: { input_tokens: 50, output_tokens: 5, total_tokens: 55 },
          }) as never,
      },
    };
    const adapter = new OpenAIAdapter(client, {
      configuredModel: { ...model, company: "openai", role: "critic" },
      pricing,
    });

    const error = (await adapter
      .execute(request({ model: { ...model, company: "openai", role: "critic" } }))
      .catch((value: unknown) => value)) as ProviderAdapterError;

    expect(error.diagnostics).toEqual([{ code: "invalid_json", path: "output_text" }]);
    expect(error.billed).toEqual({
      usage: { inputTokens: 50, outputTokens: 5, totalTokens: 55 },
      cost: { estimatedUsd: expect.closeTo(0.00006, 9) },
    });
  });

  it("leaves a failure before any response unbilled", async () => {
    const adapter = new AnthropicAdapter(
      {
        messages: {
          create: () =>
            Promise.reject(Object.assign(new Error("denied"), { status: 401 })) as never,
        },
      },
      { configuredModel: model, pricing },
    );

    const error = (await adapter
      .execute(request())
      .catch((value: unknown) => value)) as ProviderAdapterError;

    expect(error.code).toBe("authentication");
    expect(error.billed).toBeNull();
    expect(error.metadata).not.toHaveProperty("billed");
  });

  it("sums billed usage and keeps an unknown cost unknown", () => {
    const priced = {
      usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12, cachedInputTokens: 4 },
      cost: { estimatedUsd: 0.5 },
    };
    const unpriced = {
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, reasoningOutputTokens: 1 },
      cost: { estimatedUsd: null },
    };

    expect(addBilledUsage(priced, priced)).toEqual({
      usage: { inputTokens: 20, outputTokens: 4, totalTokens: 24, cachedInputTokens: 8 },
      cost: { estimatedUsd: 1 },
    });
    expect(addBilledUsage(priced, unpriced)).toEqual({
      usage: {
        inputTokens: 11,
        outputTokens: 3,
        totalTokens: 14,
        cachedInputTokens: 4,
        reasoningOutputTokens: 1,
      },
      cost: { estimatedUsd: null },
    });
    expect(addBilledUsage(undefined, undefined)).toBeUndefined();
  });

  it("adds billed usage to an error that already carries some, keeping its identity", () => {
    const billed = {
      usage: { inputTokens: 3, outputTokens: 1, totalTokens: 4 },
      cost: { estimatedUsd: 0.25 },
    };
    const error = new ProviderAdapterError("anthropic", "invalid-response", "Rejected.", {
      retryable: false,
      route: "vertex-ai",
      requestId: "request-1",
      billed,
    });

    const combined = withBilledUsage(error, billed);

    expect(combined).toMatchObject({
      code: "invalid-response",
      retryable: false,
      route: "vertex-ai",
      requestId: "request-1",
      billed: {
        usage: { inputTokens: 6, outputTokens: 2, totalTokens: 8 },
        cost: { estimatedUsd: 0.5 },
      },
    });
    expect(withBilledUsage(error, undefined)).toBe(error);
  });
});
