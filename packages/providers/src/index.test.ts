import { createHash } from "node:crypto";
import type { ModelSelection } from "@draft-loop/domain";
import { describe, expect, it, vi } from "vitest";

import {
  AnthropicAdapter,
  type AnthropicClient,
  type ModelRequest,
  OpenAIAdapter,
  type OpenAIClient,
  ProviderAdapterError,
  usesDifferentProviders,
} from "./index.js";

const model: ModelSelection = {
  company: "anthropic",
  modelId: "claude-test-exact",
  role: "author",
  promptTemplateVersion: "author-v1",
};

const policy = {
  allowTransmission: true,
  allowedCompanies: ["anthropic", "openai"],
  sensitiveData: false,
  sensitiveDataAcknowledged: false,
} as const;

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
    dataPolicy: policy,
    ...overrides,
  };
}

describe("provider-neutral model adapters", () => {
  it("sends Anthropic's exact model and structured JSON request shape", async () => {
    type Params = Parameters<AnthropicClient["messages"]["create"]>[0];
    const response = {
      id: "msg-1",
      content: [{ type: "text", text: '{"answer":"yes"}' }],
      model: model.modelId,
      usage: { input_tokens: 11, output_tokens: 7 },
    };
    let seen: Params | undefined;
    const create = (params: Params) => {
      seen = params;
      return Object.assign(Promise.resolve(response), {
        withResponse: async () => ({ data: response, request_id: "anthropic-request-1" }),
      }) as ReturnType<AnthropicClient["messages"]["create"]>;
    };
    const client: AnthropicClient = { messages: { create } };
    const adapter = new AnthropicAdapter(client, {
      configuredModel: model,
      pricing: { inputUsdPerMillionTokens: 1, outputUsdPerMillionTokens: 2 },
    });

    const result = await adapter.execute(request());

    expect(seen).toMatchObject({
      model: model.modelId,
      system: request().systemPrompt,
      messages: [{ role: "user", content: JSON.stringify(request().input) }],
      output_config: { format: { type: "json_schema", schema } },
    });
    expect(result).toMatchObject({
      output: { answer: "yes" },
      contextSnapshotId: "snapshot-1",
      provider: "anthropic",
      company: "anthropic",
      modelId: model.modelId,
      providerRequestId: "anthropic-request-1",
      usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18 },
      cost: { estimatedUsd: 0.000025 },
    });
    expect(result.structuredOutputSha256).toBe(
      createHash("sha256").update('{"answer":"yes"}').digest("hex"),
    );
  });

  it("sends OpenAI Responses input as user data and uses strict JSON schema text format", async () => {
    type Params = Parameters<OpenAIClient["responses"]["create"]>[0];
    const response = {
      id: "resp-1",
      model: "gpt-test-exact",
      output_text: '{"answer":"yes"}',
      output: [
        {
          type: "message",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: '{"answer":"yes"}', annotations: [] }],
        },
      ],
      usage: {
        input_tokens: 13,
        output_tokens: 5,
        total_tokens: 18,
        input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 0 },
      },
      _request_id: "openai-request-1",
    };
    let seen: Params | undefined;
    const create = async (params: Params) => {
      seen = params;
      return response as unknown as Awaited<ReturnType<OpenAIClient["responses"]["create"]>>;
    };
    const client: OpenAIClient = { responses: { create } };
    const openAIModel: ModelSelection = {
      ...model,
      company: "openai",
      modelId: "gpt-test-exact",
      role: "critic",
      promptTemplateVersion: "critic-v1",
    };
    const adapter = new OpenAIAdapter(client, {
      configuredModel: openAIModel,
      pricing: { inputUsdPerMillionTokens: 3, outputUsdPerMillionTokens: 4 },
    });

    const result = await adapter.execute(request({ model: openAIModel }));

    expect(seen).toMatchObject({
      model: openAIModel.modelId,
      instructions: request().systemPrompt,
      input: [
        {
          role: "user",
          content: [{ type: "input_text", text: JSON.stringify(request().input) }],
        },
      ],
      store: false,
      text: { format: { type: "json_schema", name: "answer_schema", schema, strict: true } },
    });
    expect(result).toMatchObject({
      output: { answer: "yes" },
      provider: "openai",
      company: "openai",
      modelId: openAIModel.modelId,
      providerRequestId: "openai-request-1",
      usage: { inputTokens: 13, outputTokens: 5, totalTokens: 18 },
      cost: { estimatedUsd: 0.000059 },
    });
  });

  it("does not call a provider when transmission is denied or the company is not allowlisted", async () => {
    const create = vi.fn<AnthropicClient["messages"]["create"]>();
    const client: AnthropicClient = { messages: { create } };
    const adapter = new AnthropicAdapter(client, { configuredModel: model });

    await expect(
      adapter.execute(request({ dataPolicy: { ...policy, allowTransmission: false } })),
    ).rejects.toMatchObject({ code: "policy", retryable: false });
    await expect(
      adapter.execute(request({ dataPolicy: { ...policy, allowedCompanies: ["openai"] } })),
    ).rejects.toMatchObject({ code: "policy", retryable: false });
    expect(create).not.toHaveBeenCalled();
  });

  it("requires acknowledgement before sending sensitive data", async () => {
    const create = vi.fn<AnthropicClient["messages"]["create"]>();
    const client: AnthropicClient = { messages: { create } };
    const adapter = new AnthropicAdapter(client, { configuredModel: model });

    await expect(
      adapter.execute(
        request({
          dataPolicy: { ...policy, sensitiveData: true, sensitiveDataAcknowledged: false },
        }),
      ),
    ).rejects.toMatchObject({ code: "policy" });
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects a model different from the exact configured model before calling the provider", async () => {
    const create = vi.fn<AnthropicClient["messages"]["create"]>();
    const client: AnthropicClient = { messages: { create } };
    const adapter = new AnthropicAdapter(client, { configuredModel: model });

    await expect(
      adapter.execute(request({ model: { ...model, modelId: "claude-substitute" } })),
    ).rejects.toMatchObject({ code: "invalid-request" });
    expect(create).not.toHaveBeenCalled();
  });

  it("normalizes provider errors without exposing the provider response body", async () => {
    const providerError = Object.assign(new Error("secret response body"), {
      status: 429,
      requestID: "openai-request-2",
    });
    const create = async () => {
      throw providerError;
    };
    const client: OpenAIClient = { responses: { create } };
    const openAIModel: ModelSelection = {
      ...model,
      company: "openai",
      modelId: "gpt-test-exact",
      role: "critic",
      promptTemplateVersion: "critic-v1",
    };
    const adapter = new OpenAIAdapter(client, { configuredModel: openAIModel });

    const error = await adapter
      .execute(request({ model: openAIModel }))
      .catch((value: unknown) => value);

    expect(error).toBeInstanceOf(ProviderAdapterError);
    expect(error).toMatchObject({
      code: "rate-limit",
      retryable: true,
      status: 429,
      requestId: "openai-request-2",
      metadata: { status: 429, requestId: "openai-request-2" },
    });
    expect((error as Error).message).not.toContain("secret response body");
  });

  it("preserves the provider-diversity compatibility helper", () => {
    const critic: ModelSelection = {
      ...model,
      company: "openai",
      modelId: "gpt-test-exact",
      role: "critic",
      promptTemplateVersion: "critic-v1",
    };
    expect(usesDifferentProviders(model, critic)).toBe(true);
    expect(usesDifferentProviders(model, { ...model, role: "critic" })).toBe(false);
  });
});
