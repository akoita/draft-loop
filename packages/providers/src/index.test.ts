import { createHash } from "node:crypto";
import type { ModelSelection } from "@draft-loop/domain";
import { describe, expect, it, vi } from "vitest";

import {
  AnthropicAdapter,
  type AnthropicClient,
  type ModelRequest,
  normalizeProviderError,
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
  it("normalizes explicit Anthropic and OpenAI cancellation signals without retry", () => {
    const anthropic = normalizeProviderError(
      "anthropic",
      Object.assign(new Error("sensitive abort details"), { name: "AbortError" }),
    );
    const openai = normalizeProviderError(
      "openai",
      Object.assign(new Error("sensitive cancellation details"), { code: "ERR_CANCELED" }),
    );

    expect(anthropic).toMatchObject({ code: "cancelled", retryable: false });
    expect(openai).toMatchObject({ code: "cancelled", retryable: false });
    expect(anthropic.message).not.toContain("sensitive");
    expect(openai.message).not.toContain("sensitive");
  });
  it("sends Anthropic's exact model and structured JSON request shape", async () => {
    type Params = Parameters<AnthropicClient["messages"]["create"]>[0];
    type Options = Parameters<AnthropicClient["messages"]["create"]>[1];
    const response = {
      id: "msg-1",
      content: [{ type: "text", text: '{"answer":"yes"}' }],
      model: model.modelId,
      stop_reason: "end_turn",
      usage: { input_tokens: 11, output_tokens: 7 },
    };
    let seen: Params | undefined;
    let seenOptions: Options;
    const create = (params: Params, options?: Options) => {
      seen = params;
      seenOptions = options;
      return Object.assign(Promise.resolve(response), {
        withResponse: async () => ({ data: response, request_id: "anthropic-request-1" }),
      }) as ReturnType<AnthropicClient["messages"]["create"]>;
    };
    const client: AnthropicClient = { messages: { create } };
    const adapter = new AnthropicAdapter(client, {
      configuredModel: model,
      pricing: { inputUsdPerMillionTokens: 1, outputUsdPerMillionTokens: 2 },
    });

    const controller = new AbortController();
    const result = await adapter.execute(
      request({ signal: controller.signal, maxOutputTokens: 8192 }),
    );

    expect(seen).toMatchObject({
      model: model.modelId,
      max_tokens: 8192,
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
    expect(seenOptions?.signal).toBe(controller.signal);
  });

  it("sends OpenAI Responses input as user data and uses strict JSON schema text format", async () => {
    type Params = Parameters<OpenAIClient["responses"]["create"]>[0];
    type Options = Parameters<OpenAIClient["responses"]["create"]>[1];
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
    let seenOptions: Options;
    const create = async (params: Params, options?: Options) => {
      seen = params;
      seenOptions = options;
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

    const controller = new AbortController();
    const result = await adapter.execute(
      request({ model: openAIModel, signal: controller.signal }),
    );

    expect(seen).toMatchObject({
      model: openAIModel.modelId,
      max_output_tokens: 4096,
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
    expect(seenOptions?.signal).toBe(controller.signal);
  });

  it("fails closed on Anthropic max_tokens truncation before JSON parsing", async () => {
    const response = {
      content: [{ type: "text", text: '{"answer":' }],
      model: model.modelId,
      stop_reason: "max_tokens",
      usage: { input_tokens: 11, output_tokens: 4096 },
    };
    const client: AnthropicClient = {
      messages: {
        create: () =>
          ({
            withResponse: async () => ({ data: response, request_id: "anthropic-truncated" }),
          }) as never,
      },
    };
    const adapter = new AnthropicAdapter(client, { configuredModel: model });

    const error = await adapter.execute(request()).catch((value: unknown) => value);

    expect(error).toMatchObject({
      code: "invalid-response",
      retryable: false,
      diagnostics: [{ code: "max_tokens", path: "stop_reason" }],
    });
    expect(error).not.toMatchObject({
      diagnostics: expect.arrayContaining([{ code: "invalid_json" }]),
    });
  });

  it.each(["refusal", "pause_turn", "model_context_window_exceeded"] as const)(
    "rejects Anthropic non-completion stop_reason %s without parsing output",
    async (stopReason) => {
      const response = {
        content: [{ type: "text", text: '{"answer":"not-used"}' }],
        model: model.modelId,
        stop_reason: stopReason,
        usage: { input_tokens: 11, output_tokens: 7 },
      };
      const client: AnthropicClient = {
        messages: {
          create: () =>
            ({
              withResponse: async () => ({ data: response, request_id: "anthropic-incomplete" }),
            }) as never,
        },
      };
      const adapter = new AnthropicAdapter(client, { configuredModel: model });

      await expect(adapter.execute(request())).rejects.toMatchObject({
        code: "invalid-response",
        retryable: false,
        diagnostics: [{ code: stopReason, path: "stop_reason" }],
      });
    },
  );

  it("reports an unexpected Anthropic stop_reason safely", async () => {
    const response = {
      content: [{ type: "text", text: '{"answer":"not-used"}' }],
      model: model.modelId,
      stop_reason: "stop_sequence",
      usage: { input_tokens: 11, output_tokens: 7 },
    };
    const client: AnthropicClient = {
      messages: {
        create: () =>
          ({
            withResponse: async () => ({ data: response, request_id: "anthropic-unexpected" }),
          }) as never,
      },
    };
    const adapter = new AnthropicAdapter(client, { configuredModel: model });

    await expect(adapter.execute(request())).rejects.toMatchObject({
      diagnostics: [{ code: "unexpected_stop_reason", path: "stop_reason" }],
    });
  });

  it("reports missing Anthropic text without exposing response content", async () => {
    const response = {
      content: [],
      model: model.modelId,
      stop_reason: "end_turn",
      usage: { input_tokens: 11, output_tokens: 0 },
    };
    const client: AnthropicClient = {
      messages: {
        create: () =>
          ({
            withResponse: async () => ({ data: response, request_id: "anthropic-missing-text" }),
          }) as never,
      },
    };
    const adapter = new AnthropicAdapter(client, { configuredModel: model });

    const error = await adapter.execute(request()).catch((value: unknown) => value);

    expect(error).toMatchObject({
      diagnostics: [{ code: "missing_text", path: "content" }],
    });
    expect(JSON.stringify(error)).not.toContain("not-used");
  });

  it("reports malformed Anthropic JSON without exposing the raw output", async () => {
    const rawOutput = '{"answer":';
    const response = {
      content: [{ type: "text", text: rawOutput }],
      model: model.modelId,
      stop_reason: "end_turn",
      usage: { input_tokens: 11, output_tokens: 7 },
    };
    const client: AnthropicClient = {
      messages: {
        create: () =>
          ({
            withResponse: async () => ({ data: response, request_id: "anthropic-invalid-json" }),
          }) as never,
      },
    };
    const adapter = new AnthropicAdapter(client, { configuredModel: model });

    const error = await adapter.execute(request()).catch((value: unknown) => value);

    expect(error).toMatchObject({
      diagnostics: [{ code: "invalid_json", path: "content" }],
    });
    expect(JSON.stringify(error)).not.toContain(rawOutput);
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

  it("rejects an invalid output-token budget before calling the provider", async () => {
    const create = vi.fn<AnthropicClient["messages"]["create"]>();
    const client: AnthropicClient = { messages: { create } };
    const adapter = new AnthropicAdapter(client, { configuredModel: model });

    await expect(adapter.execute(request({ maxOutputTokens: 0 }))).rejects.toMatchObject({
      code: "invalid-request",
      retryable: false,
      diagnostics: [{ code: "invalid_output_token_budget", path: "maxOutputTokens" }],
    });
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

  it("normalizes bounded retry timing from provider headers without retaining raw details", () => {
    const error = normalizeProviderError(
      "anthropic",
      Object.assign(new Error("private provider body"), {
        status: 429,
        headers: { "Retry-After": "999", "retry-after-ms": "1250" },
      }),
    );

    expect(error).toMatchObject({ code: "rate-limit", retryable: true, retryAfterMs: 1250 });
    expect(error.metadata).toEqual({ status: 429, retryAfterMs: 1250 });
    expect(JSON.stringify(error)).not.toContain("private provider body");

    const clamped = normalizeProviderError("openai", {
      status: 429,
      headers: { "retry-after-ms": "999999" },
    });
    expect(clamped.retryAfterMs).toBe(60_000);
  });

  it("normalizes OpenAI quota exhaustion as a non-retryable provider error", () => {
    const error = normalizeProviderError("openai", {
      status: 429,
      error: { code: "insufficient_quota", message: "private quota response" },
    });

    expect(error).toMatchObject({ code: "quota-exhausted", retryable: false, status: 429 });
    expect(error.message).toContain("quota-exhausted");
    expect(JSON.stringify(error)).not.toContain("private quota response");
  });

  it("retries transient rate-limit errors and recovers when subsequent attempt succeeds", async () => {
    let attempts = 0;
    const sleep = vi.fn(async () => undefined);
    const rateLimitError = Object.assign(new Error("Rate limited"), {
      status: 429,
      requestID: "openai-req-429",
      headers: { "retry-after-ms": "75" },
    });
    const successResponse = {
      output_text: '{"answer":"recovered"}',
      usage: { input_tokens: 10, output_tokens: 5 },
      _request_id: "openai-req-ok",
    } as never;

    const create = async () => {
      attempts += 1;
      if (attempts < 3) {
        throw rateLimitError;
      }
      return successResponse;
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
      retry: { maxRetries: 3, baseDelayMs: 50, maxDelayMs: 200, sleep },
    });

    const result = await adapter.execute(request({ model: openAIModel }));
    expect(result.output).toEqual({ answer: "recovered" });
    expect(attempts).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenNthCalledWith(1, 75);
    expect(sleep).toHaveBeenNthCalledWith(2, 75);
  });

  it("throws when maximum retries are exhausted on persistent rate-limit errors", async () => {
    let attempts = 0;
    const sleep = vi.fn(async () => undefined);
    const rateLimitError = Object.assign(new Error("Rate limited"), {
      status: 429,
      requestID: "openai-req-429",
    });

    const create = async () => {
      attempts += 1;
      throw rateLimitError;
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
      retry: { maxRetries: 2, baseDelayMs: 10, maxDelayMs: 50, sleep },
    });

    await expect(adapter.execute(request({ model: openAIModel }))).rejects.toMatchObject({
      code: "rate-limit",
      retryable: true,
    });
    expect(attempts).toBe(3); // Initial + 2 retries
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("returns long provider cooldowns to orchestration instead of retrying too early", async () => {
    let attempts = 0;
    const sleep = vi.fn(async () => undefined);
    const create = async () => {
      attempts += 1;
      throw Object.assign(new Error("Rate limited"), {
        status: 429,
        headers: { "retry-after-ms": "6000" },
      });
    };
    const openAIModel: ModelSelection = {
      ...model,
      company: "openai",
      modelId: "gpt-test-exact",
      role: "critic",
      promptTemplateVersion: "critic-v1",
    };
    const adapter = new OpenAIAdapter(
      { responses: { create } },
      {
        configuredModel: openAIModel,
        retry: { maxRetries: 3, maxDelayMs: 5_000, sleep },
      },
    );

    await expect(adapter.execute(request({ model: openAIModel }))).rejects.toMatchObject({
      code: "rate-limit",
      retryAfterMs: 6_000,
    });
    expect(attempts).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("fails immediately without retrying on non-retryable invalid-request errors", async () => {
    let attempts = 0;
    const sleep = vi.fn(async () => undefined);
    const badRequestError = Object.assign(new Error("Bad request"), {
      status: 400,
      requestID: "openai-req-400",
    });

    const create = async () => {
      attempts += 1;
      throw badRequestError;
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
      retry: { maxRetries: 3, baseDelayMs: 50, sleep },
    });

    await expect(adapter.execute(request({ model: openAIModel }))).rejects.toMatchObject({
      code: "invalid-request",
      retryable: false,
    });
    expect(attempts).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("notifies streaming progress callbacks on started and completed stages", async () => {
    const progressEvents: unknown[] = [];
    const response = {
      id: "msg-progress",
      content: [{ type: "text", text: '{"answer":"streamed"}' }],
      model: model.modelId,
      stop_reason: "end_turn",
      usage: { input_tokens: 15, output_tokens: 8 },
    };
    const client: AnthropicClient = {
      messages: {
        create: () =>
          ({
            withResponse: async () => ({ data: response, request_id: "anthropic-prog-1" }),
          }) as never,
      },
    };
    const adapter = new AnthropicAdapter(client, { configuredModel: model });

    const result = await adapter.execute(
      request({
        onProgress: (event) => progressEvents.push(event),
      }),
    );

    expect(result.output).toEqual({ answer: "streamed" });
    expect(progressEvents).toHaveLength(2);
    expect(progressEvents[0]).toMatchObject({ stage: "started", elapsedMs: expect.any(Number) });
    expect(progressEvents[1]).toMatchObject({
      stage: "completed",
      elapsedMs: expect.any(Number),
      tokensObserved: 23,
    });
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
