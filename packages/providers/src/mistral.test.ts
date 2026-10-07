import type { ModelSelection } from "@draft-loop/domain";
import { SDKError } from "@mistralai/mistralai/models/errors";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createMistralAdapter,
  createMistralClient,
  type JsonObject,
  MistralAdapter,
  type MistralClient,
  type ModelRequest,
  mistralBaseUrl,
  mistralCompany,
  mistralLarge4ModelId,
  mistralProvider,
  ProviderAdapterError,
} from "./index.js";

const jsonSchema = {
  type: "object",
  properties: { answer: { type: "string" } },
  required: ["answer"],
  additionalProperties: false,
} as const;

const policy = {
  allowTransmission: true,
  allowedCompanies: ["mistral"],
  sensitiveData: true,
  sensitiveDataAcknowledged: true,
} as const;

const secretMarker = "SECRET-CANDIDATE-MATERIAL";

function selection(
  options: { readonly profile?: ModelSelection["profile"]; readonly modelId?: string } = {},
): ModelSelection {
  return {
    company: mistralCompany,
    modelId: options.modelId ?? mistralLarge4ModelId,
    role: "author",
    promptTemplateVersion: "author-v1",
    ...(options.profile === undefined ? {} : { profile: options.profile }),
  };
}

function request(overrides: Partial<ModelRequest> = {}): ModelRequest {
  return {
    contextSnapshotId: "snapshot-mistral-1",
    model: selection(),
    systemPrompt: "Return one strict JSON object.",
    input: { question: secretMarker },
    outputSchema: jsonSchema,
    outputName: "fixture_output",
    dataPolicy: policy,
    ...overrides,
  };
}

interface ResponseOptions {
  readonly content?: unknown;
  readonly finishReason?: string;
  readonly model?: string;
  readonly usage?: unknown;
  readonly choices?: unknown[];
}

function completion(options: ResponseOptions = {}): unknown {
  return {
    id: "cmpl-1",
    object: "chat.completion",
    created: 1,
    model: options.model ?? "mistral-large-4-2610",
    usage: options.usage ?? { promptTokens: 120, completionTokens: 30, totalTokens: 150 },
    choices: options.choices ?? [
      {
        index: 0,
        message: {
          role: "assistant",
          content: "content" in options ? options.content : '{"answer":"ok"}',
        },
        finishReason: options.finishReason ?? "stop",
      },
    ],
  };
}

type Complete = MistralClient["chat"]["complete"];

function harness(
  responder: Complete,
  options: ConstructorParameters<typeof MistralAdapter>[1] = { configuredModel: selection() },
) {
  const complete = vi.fn<Complete>(responder);
  const adapter = new MistralAdapter({ chat: { complete } }, options);
  return { adapter, complete };
}

function httpError(status: number, body = "provider detail"): SDKError {
  const url = "https://api.mistral.ai/v1/chat/completions";
  return new SDKError(`API error occurred: Status ${status} ${body}`, {
    response: new Response(body, { status }),
    request: new Request(url, { method: "POST" }),
    body,
  });
}

async function rejection(promise: Promise<unknown>): Promise<ProviderAdapterError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ProviderAdapterError);
    return error as ProviderAdapterError;
  }
  throw new Error("expected the request to fail");
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("Mistral adapter", () => {
  it("returns schema-valid output with usage under the configured model id", async () => {
    const { adapter, complete } = harness(async () => completion());
    const progress = vi.fn();
    const response = await adapter.execute(request({ onProgress: progress }));

    expect(response.output).toEqual({ answer: "ok" });
    expect(response.provider).toBe(mistralProvider);
    expect(response.company).toBe("mistral");
    // The served version (mistral-large-4-2610) is checked, but the configured id is reported, as Gemini does.
    expect(response.modelId).toBe(mistralLarge4ModelId);
    expect(response.providerRequestId).toBe("cmpl-1");
    expect(response.usage).toMatchObject({ inputTokens: 120, outputTokens: 30, totalTokens: 150 });
    expect(response.cost).toEqual({ estimatedUsd: null });
    expect(response.structuredOutputSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ stage: "completed" }));
  });

  it("prices usage only when pricing is supplied", async () => {
    const { adapter } = harness(async () => completion(), {
      configuredModel: selection(),
      pricing: { inputUsdPerMillionTokens: 2, outputUsdPerMillionTokens: 6 },
    });
    const response = await adapter.execute(request());
    expect(response.cost.estimatedUsd).toBeCloseTo((120 * 2 + 30 * 6) / 1_000_000, 10);
  });

  it("sends a strict json_schema request with no unexpected parameters", async () => {
    const { adapter, complete } = harness(async () => completion());
    await adapter.execute(request({ maxOutputTokens: 2048 }));

    const [sent, options] = complete.mock.calls[0] ?? [];
    expect(sent).toEqual({
      model: "mistral-large-4",
      messages: [
        { role: "system", content: "Return one strict JSON object." },
        { role: "user", content: JSON.stringify({ question: secretMarker }) },
      ],
      maxTokens: 2048,
      n: 1,
      stream: false,
      responseFormat: {
        type: "json_schema",
        jsonSchema: { name: "fixture_output", schemaDefinition: jsonSchema, strict: true },
      },
    });
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(options?.retries).toEqual({ strategy: "none" });
  });

  it("takes the output budget from a matching profile", async () => {
    const runtimeProfile: NonNullable<ModelSelection["profile"]> = {
      id: "mistral-large-author",
      version: 1,
      provider: mistralCompany,
      modelId: mistralLarge4ModelId,
      tier: "standard",
      roles: ["author"],
      runtime: {
        effort: "provider-default",
        maxOutputTokens: 8192,
        thinking: { mode: "provider-default" },
      },
      knownLimits: { maxOutputTokens: 65_536, contextWindowTokens: 1_000_000 },
    };
    const model = selection({ profile: runtimeProfile });
    const { adapter, complete } = harness(async () => completion(), { configuredModel: model });
    await adapter.execute(request({ model }));
    expect(complete.mock.calls[0]?.[0].maxTokens).toBe(8192);

    const unsupported = selection({
      profile: { ...runtimeProfile, runtime: { ...runtimeProfile.runtime, effort: "high" } },
    });
    const strict = harness(async () => completion(), { configuredModel: unsupported });
    const error = await rejection(strict.adapter.execute(request({ model: unsupported })));
    expect(error.code).toBe("invalid-request");
    expect(strict.complete).not.toHaveBeenCalled();
  });

  it("rejects a mismatched model or policy before any transport call", async () => {
    const { adapter, complete } = harness(async () => completion());
    const model = await rejection(
      adapter.execute(request({ model: selection({ modelId: "mistral-small-4" }) })),
    );
    expect(model.code).toBe("invalid-request");
    const denied = await rejection(
      adapter.execute(request({ dataPolicy: { ...policy, allowedCompanies: ["openai"] } })),
    );
    expect(denied.code).toBe("policy");
    expect(complete).not.toHaveBeenCalled();
  });

  it("joins text chunks and ignores reasoning chunks", async () => {
    const { adapter } = harness(async () =>
      completion({
        content: [
          { type: "thinking", thinking: [{ type: "text", text: "private" }] },
          { type: "text", text: '{"answer":' },
          { type: "text", text: '"chunked"}' },
        ],
      }),
    );
    const response = await adapter.execute(request());
    expect(response.output).toEqual({ answer: "chunked" });
  });

  it("rejects schema-invalid output without echoing it", async () => {
    const { adapter } = harness(async () =>
      completion({ content: `{"answer":7,"x":"${secretMarker}"}` }),
    );
    const error = await rejection(adapter.execute(request()));
    expect(error.code).toBe("invalid-response");
    expect(error.failureStage).toBe("response-schema-validation");
    expect(error.diagnostics).toEqual([{ code: "output_schema_mismatch", path: "response" }]);
    expect(error.diagnosticCounts.length).toBeGreaterThan(0);
    expect(JSON.stringify(error.metadata) + error.message).not.toContain(secretMarker);
  });

  it("rejects output that is not JSON", async () => {
    const { adapter } = harness(async () => completion({ content: "not json" }));
    const error = await rejection(adapter.execute(request()));
    expect(error.diagnostics).toEqual([{ code: "invalid_json", path: "response" }]);
  });

  it.each([
    ["empty string", ""],
    ["null", null],
    ["blank", "   "],
  ])("rejects empty output (%s)", async (_label, content) => {
    const { adapter } = harness(async () => completion({ content }));
    const error = await rejection(adapter.execute(request()));
    expect(error.code).toBe("invalid-response");
    expect(error.diagnostics).toEqual([{ code: "missing_output", path: "response" }]);
  });

  it("reports content filtering as a refusal", async () => {
    const { adapter } = harness(async () =>
      completion({ content: "", finishReason: "content_filter" }),
    );
    const error = await rejection(adapter.execute(request()));
    expect(error.code).toBe("invalid-response");
    expect(error.diagnostics).toEqual([{ code: "refusal", path: "response" }]);
  });

  it("reports finish_reason length as an exhausted output budget", async () => {
    const { adapter, complete } = harness(async () =>
      completion({ content: '{"answer":"tru', finishReason: "length" }),
    );
    const error = await rejection(adapter.execute(request()));
    expect(error.failureStage).toBe("output-token-budget-exceeded");
    expect(error.diagnostics).toEqual([{ code: "output_token_limit_reached", path: "response" }]);
    expect(error.retryable).toBe(false);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["model_length", "context_length_reached"],
    ["error", "incomplete_response"],
    ["tool_calls", "incomplete_response"],
  ])("rejects finish_reason %s", async (finishReason, code) => {
    const { adapter } = harness(async () => completion({ finishReason }));
    const error = await rejection(adapter.execute(request()));
    expect(error.diagnostics).toEqual([{ code, path: "response" }]);
  });

  it.each([
    ["no choices", completion({ choices: [] })],
    ["two choices", completion({ choices: [{}, {}] })],
    ["a non-object", "text"],
    [
      "tool calls",
      completion({
        choices: [{ message: { content: "x", toolCalls: [{}] }, finishReason: "stop" }],
      }),
    ],
    ["an unknown chunk", completion({ content: [{ type: "image_url", imageUrl: "x" }] })],
  ])("rejects a malformed response (%s)", async (_label, body) => {
    const { adapter } = harness(async () => body);
    const error = await rejection(adapter.execute(request()));
    expect(error.code).toBe("invalid-response");
    expect(error.diagnostics).toEqual([{ code: "malformed_response", path: "response" }]);
  });

  it("rejects a response from an unexpected model", async () => {
    const { adapter } = harness(async () => completion({ model: "mistral-small-4" }));
    const error = await rejection(adapter.execute(request()));
    expect(error.diagnostics).toEqual([{ code: "unexpected_response_model", path: "response" }]);
  });

  it("retries a 429 and then succeeds", async () => {
    const sleep = vi.fn(async () => undefined);
    const complete = vi
      .fn<Complete>()
      .mockRejectedValueOnce(httpError(429))
      .mockResolvedValueOnce(completion());
    const adapter = new MistralAdapter(
      { chat: { complete } },
      { configuredModel: selection(), retry: { maxRetries: 1, baseDelayMs: 1, sleep } },
    );
    const response = await adapter.execute(request());
    expect(response.output).toEqual({ answer: "ok" });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("retries a 503 up to the bounded limit", async () => {
    const sleep = vi.fn(async () => undefined);
    const complete = vi.fn<Complete>().mockRejectedValue(httpError(503));
    const adapter = new MistralAdapter(
      { chat: { complete } },
      { configuredModel: selection(), retry: { maxRetries: 2, baseDelayMs: 1, sleep } },
    );
    const error = await rejection(adapter.execute(request()));
    expect(error.code).toBe("transient");
    expect(error.status).toBe(503);
    expect(complete).toHaveBeenCalledTimes(3);
  });

  it("rejects a retry limit above the bound", () => {
    expect(
      () =>
        new MistralAdapter(
          { chat: { complete: vi.fn<Complete>() } },
          { configuredModel: selection(), retry: { maxRetries: 3 } },
        ),
    ).toThrow(ProviderAdapterError);
  });

  it.each([
    [400, "invalid-request"],
    [401, "authentication"],
    [403, "permission"],
    [404, "invalid-request"],
    [422, "invalid-request"],
  ])("does not retry a %i", async (status, code) => {
    const sleep = vi.fn(async () => undefined);
    const complete = vi.fn<Complete>().mockRejectedValue(httpError(status));
    const adapter = new MistralAdapter(
      { chat: { complete } },
      { configuredModel: selection(), retry: { maxRetries: 2, baseDelayMs: 1, sleep } },
    );
    const error = await rejection(adapter.execute(request()));
    expect(error.code).toBe(code);
    expect(error.status).toBe(status);
    expect(error.retryable).toBe(false);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("classifies a schema rejection without copying the provider message", async () => {
    const complete = vi
      .fn<Complete>()
      .mockRejectedValue(httpError(400, `invalid schema near ${secretMarker}`));
    const adapter = new MistralAdapter({ chat: { complete } }, { configuredModel: selection() });
    const error = await rejection(adapter.execute(request()));
    expect(error.diagnostics).toEqual([{ code: "provider_rejected_schema", path: "request" }]);
    expect(error.message).not.toContain(secretMarker);
  });

  it("never exposes the API key or request content in errors", async () => {
    const apiKey = "mistral-test-key-123";
    const complete = vi
      .fn<Complete>()
      .mockRejectedValue(httpError(401, `bad key ${apiKey} for ${secretMarker}`));
    const adapter = new MistralAdapter({ chat: { complete } }, { configuredModel: selection() });
    const error = await rejection(adapter.execute(request()));
    const serialized = JSON.stringify({ message: error.message, metadata: error.metadata });
    expect(serialized).not.toContain(apiKey);
    expect(serialized).not.toContain(secretMarker);
  });

  it("cancels when the caller aborts mid-request without retrying", async () => {
    const controller = new AbortController();
    const complete = vi.fn<Complete>(() => new Promise(() => undefined));
    const adapter = new MistralAdapter(
      { chat: { complete } },
      { configuredModel: selection(), retry: { maxRetries: 2, baseDelayMs: 1 } },
    );
    const pending = adapter.execute(request({ signal: controller.signal }));
    await vi.waitFor(() => expect(complete).toHaveBeenCalledTimes(1));
    const sentSignal = complete.mock.calls[0]?.[1]?.signal;
    controller.abort();
    const error = await rejection(pending);
    expect(error.code).toBe("cancelled");
    expect(error.retryable).toBe(false);
    expect(sentSignal?.aborted).toBe(true);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("does not call the transport when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const { adapter, complete } = harness(async () => completion());
    const error = await rejection(adapter.execute(request({ signal: controller.signal })));
    expect(error.code).toBe("cancelled");
    expect(complete).not.toHaveBeenCalled();
  });

  it("times out a request that never settles and retries it", async () => {
    vi.useFakeTimers();
    const complete = vi
      .fn<Complete>()
      .mockImplementationOnce(() => new Promise(() => undefined))
      .mockResolvedValueOnce(completion());
    const adapter = new MistralAdapter(
      { chat: { complete } },
      {
        configuredModel: selection(),
        timeoutMs: 1000,
        retry: { maxRetries: 1, baseDelayMs: 1, sleep: async () => undefined },
      },
    );
    const pending = adapter.execute(request());
    await vi.advanceTimersByTimeAsync(1000);
    const response = await pending;
    expect(response.output).toEqual({ answer: "ok" });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it("reports a timeout when retries are exhausted", async () => {
    vi.useFakeTimers();
    const complete = vi.fn<Complete>(() => new Promise(() => undefined));
    const adapter = new MistralAdapter(
      { chat: { complete } },
      { configuredModel: selection(), timeoutMs: 500 },
    );
    const pending = rejection(adapter.execute(request()));
    await vi.advanceTimersByTimeAsync(500);
    const error = await pending;
    expect(error.code).toBe("timeout");
    expect(error.retryable).toBe(true);
  });

  it("creates adapters through the factory and builds the pinned client offline", () => {
    const client = createMistralClient("test-key");
    expect(typeof client.chat.complete).toBe("function");
    expect(mistralBaseUrl).toBe("https://api.mistral.ai");
    const adapter = createMistralAdapter<JsonObject, JsonObject>(client, {
      configuredModel: selection(),
    });
    expect(adapter.provider).toBe("mistral");
  });
});
