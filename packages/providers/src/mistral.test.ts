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
}

const finalUsage = { promptTokens: 120, completionTokens: 30, totalTokens: 150 };

/** One streamed server-sent event as the SDK delivers it. */
function chunk(
  delta: unknown,
  finishReason: string | null = null,
  extra: { readonly model?: string; readonly usage?: unknown } = {},
): unknown {
  return {
    data: {
      id: "cmpl-1",
      object: "chat.completion.chunk",
      created: 1,
      model: extra.model ?? "mistral-large-4-2610",
      ...(extra.usage === undefined ? {} : { usage: extra.usage }),
      choices: [{ index: 0, delta, finishReason }],
    },
  };
}

/** An answer streamed in several deltas; the last chunk carries the finish reason and usage. */
function completionEvents(options: ResponseOptions = {}): unknown[] {
  const content = "content" in options ? options.content : '{"answer":"ok"}';
  const finishReason = options.finishReason ?? "stop";
  const model = options.model === undefined ? {} : { model: options.model };
  const usage = options.usage ?? finalUsage;
  if (typeof content === "string" && content.length > 1) {
    const middle = Math.floor(content.length / 2);
    return [
      chunk({ role: "assistant", content: "" }, null, model),
      chunk({ content: content.slice(0, middle) }, null, model),
      chunk({ content: content.slice(middle) }, finishReason, { ...model, usage }),
    ];
  }
  return [chunk({ role: "assistant", content }, finishReason, { ...model, usage })];
}

async function* streamOf(events: readonly unknown[]): AsyncGenerator<unknown> {
  for (const event of events) yield event;
}

function completion(options: ResponseOptions = {}): AsyncIterable<unknown> {
  return streamOf(completionEvents(options));
}

type Stream = MistralClient["chat"]["stream"];

function harness(
  responder: Stream,
  options: ConstructorParameters<typeof MistralAdapter>[1] = { configuredModel: selection() },
) {
  const stream = vi.fn<Stream>(responder);
  const adapter = new MistralAdapter({ chat: { stream } }, options);
  return { adapter, stream };
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

const never = () => new Promise<never>(() => undefined);
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const noSleep = async () => undefined;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("Mistral adapter", () => {
  it("returns schema-valid output with usage under the configured model id", async () => {
    const { adapter, stream } = harness(async () => completion());
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
    expect(stream).toHaveBeenCalledTimes(1);
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ stage: "completed" }));
  });

  it("takes usage from the final chunk, not an earlier one", async () => {
    const events = [
      chunk({ content: '{"answer":' }, null, {
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      }),
      chunk({ content: '"ok"}' }, "stop", { usage: finalUsage }),
    ];
    const { adapter } = harness(async () => streamOf(events));
    const response = await adapter.execute(request());
    expect(response.usage).toMatchObject({ inputTokens: 120, outputTokens: 30, totalTokens: 150 });
  });

  it("prices usage only when pricing is supplied", async () => {
    const { adapter } = harness(async () => completion(), {
      configuredModel: selection(),
      pricing: { inputUsdPerMillionTokens: 2, outputUsdPerMillionTokens: 6 },
    });
    const response = await adapter.execute(request());
    expect(response.cost.estimatedUsd).toBeCloseTo((120 * 2 + 30 * 6) / 1_000_000, 10);
  });

  it("sends a strict streaming json_schema request with no unexpected parameters", async () => {
    const { adapter, stream } = harness(async () => completion());
    await adapter.execute(request({ maxOutputTokens: 2048 }));

    const [sent, options] = stream.mock.calls[0] ?? [];
    expect(sent).toEqual({
      model: "mistral-large-4",
      messages: [
        { role: "system", content: "Return one strict JSON object." },
        { role: "user", content: JSON.stringify({ question: secretMarker }) },
      ],
      maxTokens: 2048,
      n: 1,
      stream: true,
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
    const { adapter, stream } = harness(async () => completion(), { configuredModel: model });
    await adapter.execute(request({ model }));
    expect(stream.mock.calls[0]?.[0].maxTokens).toBe(8192);

    const unsupported = selection({
      profile: { ...runtimeProfile, runtime: { ...runtimeProfile.runtime, effort: "high" } },
    });
    const strict = harness(async () => completion(), { configuredModel: unsupported });
    const error = await rejection(strict.adapter.execute(request({ model: unsupported })));
    expect(error.code).toBe("invalid-request");
    expect(strict.stream).not.toHaveBeenCalled();
  });

  it("sends reasoningEffort none only for a disabled-thinking profile", async () => {
    const profileWith = (
      thinking: NonNullable<ModelSelection["profile"]>["runtime"]["thinking"],
      effort: NonNullable<ModelSelection["profile"]>["runtime"]["effort"] = "provider-default",
    ): NonNullable<ModelSelection["profile"]> => ({
      id: "mistral-profile",
      version: 1,
      provider: mistralCompany,
      modelId: mistralLarge4ModelId,
      tier: "economy",
      roles: ["author"],
      runtime: { effort, maxOutputTokens: 8192, thinking },
      knownLimits: { maxOutputTokens: 65_536, contextWindowTokens: 1_000_000 },
    });

    const disabled = selection({ profile: profileWith({ mode: "disabled" }) });
    const extraction = harness(async () => completion(), { configuredModel: disabled });
    await extraction.adapter.execute(request({ model: disabled }));
    expect(extraction.stream.mock.calls[0]?.[0]).toMatchObject({
      reasoningEffort: "none",
      maxTokens: 8192,
    });

    const providerDefault = selection({ profile: profileWith({ mode: "provider-default" }) });
    const author = harness(async () => completion(), { configuredModel: providerDefault });
    await author.adapter.execute(request({ model: providerDefault }));
    expect(author.stream.mock.calls[0]?.[0]).not.toHaveProperty("reasoningEffort");

    const noProfile = harness(async () => completion());
    await noProfile.adapter.execute(request());
    expect(noProfile.stream.mock.calls[0]?.[0]).not.toHaveProperty("reasoningEffort");

    for (const unsupported of [
      profileWith({ mode: "disabled" }, "low"),
      profileWith({ mode: "disabled" }, "high"),
      profileWith({ mode: "budgeted", maxTokens: 1024 }),
    ]) {
      const model = selection({ profile: unsupported });
      const strict = harness(async () => completion(), { configuredModel: model });
      const error = await rejection(strict.adapter.execute(request({ model })));
      expect(error.code).toBe("invalid-request");
      expect(strict.stream).not.toHaveBeenCalled();
    }
  });

  it("rejects a mismatched model or policy before any transport call", async () => {
    const { adapter, stream } = harness(async () => completion());
    const model = await rejection(
      adapter.execute(request({ model: selection({ modelId: "mistral-small-4" }) })),
    );
    expect(model.code).toBe("invalid-request");
    const denied = await rejection(
      adapter.execute(request({ dataPolicy: { ...policy, allowedCompanies: ["openai"] } })),
    );
    expect(denied.code).toBe("policy");
    expect(stream).not.toHaveBeenCalled();
  });

  it("joins text deltas and ignores reasoning chunks", async () => {
    const events = [
      chunk({
        content: [{ type: "thinking", thinking: [{ type: "text", text: "private" }] }],
      }),
      chunk({ content: [{ type: "text", text: '{"answer":' }] }),
      chunk({ content: [{ type: "text", text: '"chunked"}' }] }, "stop", { usage: finalUsage }),
    ];
    const { adapter } = harness(async () => streamOf(events));
    const response = await adapter.execute(request());
    expect(response.output).toEqual({ answer: "chunked" });
  });

  it("rejects schema-invalid accumulated output without echoing it", async () => {
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
    const { adapter, stream } = harness(async () =>
      completion({ content: '{"answer":"tru', finishReason: "length" }),
    );
    const error = await rejection(adapter.execute(request()));
    expect(error.failureStage).toBe("output-token-budget-exceeded");
    expect(error.diagnostics).toEqual([{ code: "output_token_limit_reached", path: "response" }]);
    expect(error.retryable).toBe(false);
    expect(stream).toHaveBeenCalledTimes(1);
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
    ["a non-stream body", "text"],
    ["an event without data", streamOf([{}])],
    [
      "two choices",
      streamOf([
        {
          data: {
            id: "c",
            model: "mistral-large-4",
            choices: [
              { index: 0, delta: {}, finishReason: null },
              { index: 1, delta: {}, finishReason: null },
            ],
          },
        },
      ]),
    ],
    [
      "tool calls",
      streamOf([chunk({ content: "x", toolCalls: [{ id: "t" }] }, "stop", { usage: finalUsage })]),
    ],
    ["an unknown content chunk", streamOf([chunk({ content: [{ type: "image_url" }] })])],
    [
      "content after the finish",
      streamOf([chunk({ content: "a" }, "stop"), chunk({ content: "b" })]),
    ],
  ])("rejects a malformed stream (%s)", async (_label, body) => {
    const { adapter } = harness(async () => body as AsyncIterable<unknown>);
    const error = await rejection(adapter.execute(request()));
    expect(error.code).toBe("invalid-response");
    expect(error.retryable).toBe(true);
    expect(error.diagnostics).toEqual([{ code: "malformed_stream", path: "response" }]);
    expect(error.diagnosticCounts).toHaveLength(1);
  });

  it("rejects a stream from an unexpected model", async () => {
    const { adapter } = harness(async () => completion({ model: "mistral-small-4" }));
    const error = await rejection(adapter.execute(request()));
    expect(error.diagnostics).toEqual([{ code: "unexpected_response_model", path: "response" }]);
  });

  it("retries a 429 raised before the stream starts and then succeeds", async () => {
    const sleep = vi.fn(async () => undefined);
    const stream = vi
      .fn<Stream>()
      .mockRejectedValueOnce(httpError(429))
      .mockResolvedValueOnce(completion());
    const adapter = new MistralAdapter(
      { chat: { stream } },
      { configuredModel: selection(), retry: { maxRetries: 1, baseDelayMs: 1, sleep } },
    );
    const response = await adapter.execute(request());
    expect(response.output).toEqual({ answer: "ok" });
    expect(stream).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("retries a 503 up to the bounded limit", async () => {
    const sleep = vi.fn(async () => undefined);
    const stream = vi.fn<Stream>().mockRejectedValue(httpError(503));
    const adapter = new MistralAdapter(
      { chat: { stream } },
      { configuredModel: selection(), retry: { maxRetries: 2, baseDelayMs: 1, sleep } },
    );
    const error = await rejection(adapter.execute(request()));
    expect(error.code).toBe("transient");
    expect(error.status).toBe(503);
    expect(stream).toHaveBeenCalledTimes(3);
  });

  it("rejects a retry limit above the bound", () => {
    expect(
      () =>
        new MistralAdapter(
          { chat: { stream: vi.fn<Stream>() } },
          { configuredModel: selection(), retry: { maxRetries: 3 } },
        ),
    ).toThrow(ProviderAdapterError);
  });

  it.each([
    ["idle", { idleTimeoutMs: 0 }],
    ["idle", { idleTimeoutMs: 2_147_483_648 }],
    ["total", { totalTimeoutMs: -1 }],
  ])("rejects an invalid %s timeout", (_label, timeouts) => {
    expect(
      () =>
        new MistralAdapter(
          { chat: { stream: vi.fn<Stream>() } },
          { configuredModel: selection(), ...timeouts },
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
    const stream = vi.fn<Stream>().mockRejectedValue(httpError(status));
    const adapter = new MistralAdapter(
      { chat: { stream } },
      { configuredModel: selection(), retry: { maxRetries: 2, baseDelayMs: 1, sleep } },
    );
    const error = await rejection(adapter.execute(request()));
    expect(error.code).toBe(code);
    expect(error.status).toBe(status);
    expect(error.retryable).toBe(false);
    expect(stream).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("classifies a schema rejection without copying the provider message", async () => {
    const stream = vi
      .fn<Stream>()
      .mockRejectedValue(httpError(400, `invalid schema near ${secretMarker}`));
    const adapter = new MistralAdapter({ chat: { stream } }, { configuredModel: selection() });
    const error = await rejection(adapter.execute(request()));
    expect(error.diagnostics).toEqual([{ code: "provider_rejected_schema", path: "request" }]);
    expect(error.message).not.toContain(secretMarker);
  });

  it("never exposes the API key or request content in errors", async () => {
    const apiKey = "mistral-test-key-123";
    const stream = vi
      .fn<Stream>()
      .mockRejectedValue(httpError(401, `bad key ${apiKey} for ${secretMarker}`));
    const adapter = new MistralAdapter({ chat: { stream } }, { configuredModel: selection() });
    const error = await rejection(adapter.execute(request()));
    const serialized = JSON.stringify({ message: error.message, metadata: error.metadata });
    expect(serialized).not.toContain(apiKey);
    expect(serialized).not.toContain(secretMarker);
  });

  it("cancels when the caller aborts before the stream opens without retrying", async () => {
    const controller = new AbortController();
    const stream = vi.fn<Stream>(never);
    const adapter = new MistralAdapter(
      { chat: { stream } },
      { configuredModel: selection(), retry: { maxRetries: 2, baseDelayMs: 1 } },
    );
    const pending = adapter.execute(request({ signal: controller.signal }));
    await vi.waitFor(() => expect(stream).toHaveBeenCalledTimes(1));
    const sentSignal = stream.mock.calls[0]?.[1]?.signal;
    controller.abort();
    const error = await rejection(pending);
    expect(error.code).toBe("cancelled");
    expect(error.retryable).toBe(false);
    expect(sentSignal?.aborted).toBe(true);
    expect(stream).toHaveBeenCalledTimes(1);
  });

  it("cancels when the caller aborts mid-stream without retrying", async () => {
    const controller = new AbortController();
    async function* stalled(): AsyncGenerator<unknown> {
      yield chunk({ content: '{"answer":' });
      await never();
    }
    const stream = vi.fn<Stream>(async () => stalled());
    const adapter = new MistralAdapter(
      { chat: { stream } },
      { configuredModel: selection(), retry: { maxRetries: 2, baseDelayMs: 1 } },
    );
    const progress = vi.fn();
    const pending = adapter.execute(request({ signal: controller.signal, onProgress: progress }));
    await vi.waitFor(() => expect(stream).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    const sentSignal = stream.mock.calls[0]?.[1]?.signal;
    controller.abort();
    const error = await rejection(pending);
    expect(error.code).toBe("cancelled");
    expect(error.retryable).toBe(false);
    expect(sentSignal?.aborted).toBe(true);
    expect(stream).toHaveBeenCalledTimes(1);
    expect(progress).not.toHaveBeenCalledWith(expect.objectContaining({ stage: "completed" }));
  });

  it("does not call the transport when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const { adapter, stream } = harness(async () => completion());
    const error = await rejection(adapter.execute(request({ signal: controller.signal })));
    expect(error.code).toBe("cancelled");
    expect(stream).not.toHaveBeenCalled();
  });

  it("creates adapters through the factory and builds the pinned client offline", () => {
    const client = createMistralClient("test-key");
    expect(typeof client.chat.stream).toBe("function");
    expect(mistralBaseUrl).toBe("https://api.mistral.ai");
    const adapter = createMistralAdapter<JsonObject, JsonObject>(client, {
      configuredModel: selection(),
    });
    expect(adapter.provider).toBe("mistral");
  });
});

describe("Mistral streaming deadlines", () => {
  it("completes a long answer that keeps streaming past the old five-minute deadline", async () => {
    vi.useFakeTimers();
    const pieces = ['{"answer":"', ..."abcdefghij".split(""), '"}'];
    async function* steady(): AsyncGenerator<unknown> {
      for (const [index, piece] of pieces.entries()) {
        await delay(40_000);
        yield chunk(
          { content: piece },
          index === pieces.length - 1 ? "stop" : null,
          index === pieces.length - 1 ? { usage: finalUsage } : {},
        );
      }
    }
    const { adapter } = harness(async () => steady());
    const progress = vi.fn();
    const pending = adapter.execute(request({ onProgress: progress }));
    // 12 chunks x 40 s = 480 s: far beyond the old 300 s total, with a gap under the 90 s idle limit.
    await vi.advanceTimersByTimeAsync(480_000);
    const response = await pending;
    expect(response.output).toEqual({ answer: "abcdefghij" });
    expect(progress).toHaveBeenLastCalledWith(
      expect.objectContaining({ stage: "completed", elapsedMs: 480_000 }),
    );
  });

  it("times out when chunks stop and reports volume without content", async () => {
    vi.useFakeTimers();
    async function* stalls(): AsyncGenerator<unknown> {
      yield chunk({ content: `{"answer":"${secretMarker}` });
      await never();
    }
    const stream = vi.fn<Stream>(async () => stalls());
    const adapter = new MistralAdapter(
      { chat: { stream } },
      { configuredModel: selection(), idleTimeoutMs: 1000 },
    );
    const pending = rejection(adapter.execute(request()));
    await vi.advanceTimersByTimeAsync(999);
    expect(stream.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const error = await pending;
    expect(error.code).toBe("timeout");
    expect(error.retryable).toBe(true);
    expect(error.diagnostics).toEqual([
      { code: "stream_timeout_idle", path: "response.stream.idle" },
    ]);
    expect(error.diagnosticCounts).toEqual([
      { code: "stream_answer_characters", count: `{"answer":"${secretMarker}`.length },
    ]);
    expect(JSON.stringify(error.metadata) + error.message).not.toContain(secretMarker);
    expect(stream.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it("resets the idle timer on every chunk, even an empty one", async () => {
    vi.useFakeTimers();
    async function* trickle(): AsyncGenerator<unknown> {
      for (let index = 0; index < 5; index += 1) {
        await delay(800);
        yield chunk({ content: "" });
      }
      yield chunk({ content: '{"answer":"ok"}' }, "stop", { usage: finalUsage });
    }
    const { adapter } = harness(async () => trickle(), {
      configuredModel: selection(),
      idleTimeoutMs: 1000,
    });
    const pending = adapter.execute(request());
    await vi.advanceTimersByTimeAsync(4000);
    expect((await pending).output).toEqual({ answer: "ok" });
  });

  it("times out a stream that never opens and retries it", async () => {
    vi.useFakeTimers();
    const stream = vi
      .fn<Stream>()
      .mockImplementationOnce(never)
      .mockResolvedValueOnce(completion());
    const adapter = new MistralAdapter(
      { chat: { stream } },
      {
        configuredModel: selection(),
        idleTimeoutMs: 1000,
        retry: { maxRetries: 1, baseDelayMs: 1, sleep: noSleep },
      },
    );
    const pending = adapter.execute(request());
    await vi.advanceTimersByTimeAsync(1000);
    expect((await pending).output).toEqual({ answer: "ok" });
    expect(stream).toHaveBeenCalledTimes(2);
    expect(stream.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it("retries an idle timeout and reports it when retries are exhausted", async () => {
    vi.useFakeTimers();
    const stream = vi.fn<Stream>(never);
    const adapter = new MistralAdapter(
      { chat: { stream } },
      {
        configuredModel: selection(),
        idleTimeoutMs: 500,
        retry: { maxRetries: 1, baseDelayMs: 1, sleep: noSleep },
      },
    );
    const pending = rejection(adapter.execute(request()));
    await vi.advanceTimersByTimeAsync(1000);
    const error = await pending;
    expect(error.code).toBe("timeout");
    expect(error.retryable).toBe(true);
    expect(error.diagnostics).toEqual([
      { code: "stream_timeout_initial", path: "response.stream.initial" },
    ]);
    expect(stream).toHaveBeenCalledTimes(2);
  });

  it("stops a steadily streaming answer at the overall cap", async () => {
    vi.useFakeTimers();
    async function* endless(): AsyncGenerator<unknown> {
      while (true) {
        await delay(300);
        yield chunk({ content: "x" });
      }
    }
    const stream = vi.fn<Stream>(async () => endless());
    const adapter = new MistralAdapter(
      { chat: { stream } },
      { configuredModel: selection(), idleTimeoutMs: 400, totalTimeoutMs: 1000 },
    );
    const pending = rejection(adapter.execute(request()));
    await vi.advanceTimersByTimeAsync(1000);
    const error = await pending;
    expect(error.code).toBe("timeout");
    expect(error.retryable).toBe(true);
    expect(error.diagnostics).toEqual([
      { code: "stream_timeout_total", path: "response.stream.total" },
    ]);
    expect(stream.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });
});

describe("Mistral interrupted streams", () => {
  it("retries a transport failure that cuts the stream mid-answer", async () => {
    async function* cutOff(): AsyncGenerator<unknown> {
      yield chunk({ content: `{"answer":"${secretMarker}` });
      throw new TypeError("terminated", { cause: new Error("other side closed") });
    }
    const stream = vi
      .fn<Stream>()
      .mockImplementationOnce(async () => cutOff())
      .mockResolvedValueOnce(completion());
    const adapter = new MistralAdapter(
      { chat: { stream } },
      { configuredModel: selection(), retry: { maxRetries: 1, baseDelayMs: 1, sleep: noSleep } },
    );
    expect((await adapter.execute(request())).output).toEqual({ answer: "ok" });
    expect(stream).toHaveBeenCalledTimes(2);
  });

  it("reports an interrupted stream as transient without echoing content", async () => {
    async function* cutOff(): AsyncGenerator<unknown> {
      yield chunk({ content: secretMarker });
      throw new TypeError("terminated", { cause: new Error("other side closed") });
    }
    const { adapter } = harness(async () => cutOff());
    const error = await rejection(adapter.execute(request()));
    expect(error.code).toBe("transient");
    expect(error.retryable).toBe(true);
    expect(error.diagnostics).toEqual([{ code: "stream_interrupted", path: "response.stream" }]);
    expect(JSON.stringify(error.metadata) + error.message).not.toContain(secretMarker);
  });

  it("reports a stream that ends without a finish reason as incomplete", async () => {
    const events = [chunk({ content: `{"answer":"${secretMarker}` })];
    const { adapter, stream } = harness(async () => streamOf(events));
    const error = await rejection(adapter.execute(request()));
    expect(error.code).toBe("invalid-response");
    expect(error.retryable).toBe(true);
    expect(error.diagnostics).toEqual([{ code: "incomplete_stream", path: "response" }]);
    expect(JSON.stringify(error.metadata) + error.message).not.toContain(secretMarker);
    expect(stream).toHaveBeenCalledTimes(1);
  });

  it("maps an SDK chunk-validation failure to a malformed response", async () => {
    async function* invalid(): AsyncGenerator<unknown> {
      const error = new Error(`bad chunk ${secretMarker}`);
      error.name = "ZodError";
      yield chunk({ content: "{" });
      throw error;
    }
    const { adapter } = harness(async () => invalid());
    const error = await rejection(adapter.execute(request()));
    expect(error.diagnostics).toEqual([{ code: "malformed_response", path: "response" }]);
    expect(error.message).not.toContain(secretMarker);
    expect(error.retryable).toBe(false);
  });
});

describe("Mistral broken-reply retries", () => {
  const retry = { maxRetries: 1, baseDelayMs: 1, sleep: noSleep } as const;
  const cutOffEvents = [chunk({ content: `{"answer":"${secretMarker}` })];

  it("retries a stream that ends without a finish reason and returns the next output", async () => {
    const stream = vi
      .fn<Stream>()
      .mockImplementationOnce(async () => streamOf(cutOffEvents))
      .mockResolvedValueOnce(completion());
    const adapter = new MistralAdapter(
      { chat: { stream } },
      { configuredModel: selection(), retry },
    );
    expect((await adapter.execute(request())).output).toEqual({ answer: "ok" });
    expect(stream).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["invalid JSON", { content: "not json" }],
    ["empty output", { content: "" }],
    ["an unfinished response", { finishReason: "error" }],
  ])("retries %s once and then succeeds", async (_label, broken) => {
    const stream = vi
      .fn<Stream>()
      .mockImplementationOnce(async () => completion(broken))
      .mockResolvedValueOnce(completion());
    const adapter = new MistralAdapter(
      { chat: { stream } },
      { configuredModel: selection(), retry },
    );
    expect((await adapter.execute(request())).output).toEqual({ answer: "ok" });
    expect(stream).toHaveBeenCalledTimes(2);
  });

  it("retries a malformed stream up to the bounded limit", async () => {
    const stream = vi.fn<Stream>(async () => streamOf([{}]));
    const adapter = new MistralAdapter(
      { chat: { stream } },
      { configuredModel: selection(), retry: { ...retry, maxRetries: 2 } },
    );
    const error = await rejection(adapter.execute(request()));
    expect(error.diagnostics).toEqual([{ code: "malformed_stream", path: "response" }]);
    expect(stream).toHaveBeenCalledTimes(3);
  });

  it.each([
    ["a schema mismatch", { content: '{"answer":7}' }, "output_schema_mismatch"],
    ["a refusal", { content: "", finishReason: "content_filter" }, "refusal"],
    [
      "the output limit",
      { content: '{"answer":"tru', finishReason: "length" },
      "output_token_limit_reached",
    ],
    ["the context limit", { finishReason: "model_length" }, "context_length_reached"],
    ["an unexpected model", { model: "mistral-small-4" }, "unexpected_response_model"],
  ])("does not retry %s", async (_label, broken, code) => {
    const stream = vi.fn<Stream>(async () => completion(broken));
    const adapter = new MistralAdapter(
      { chat: { stream } },
      { configuredModel: selection(), retry },
    );
    const error = await rejection(adapter.execute(request()));
    expect(error.diagnostics).toEqual([{ code, path: "response" }]);
    expect(error.retryable).toBe(false);
    expect(stream).toHaveBeenCalledTimes(1);
  });

  it("stops during the retry delay when the caller cancels", async () => {
    const controller = new AbortController();
    const sleep = vi.fn(() => never());
    const stream = vi.fn<Stream>(async () => streamOf(cutOffEvents));
    const adapter = new MistralAdapter(
      { chat: { stream } },
      { configuredModel: selection(), retry: { maxRetries: 2, baseDelayMs: 1, sleep } },
    );
    const pending = rejection(adapter.execute(request({ signal: controller.signal })));
    await vi.waitFor(() => expect(sleep).toHaveBeenCalledTimes(1));
    controller.abort();
    const error = await pending;
    expect(error.code).toBe("cancelled");
    expect(error.retryable).toBe(false);
    expect(stream).toHaveBeenCalledTimes(1);
  });
});
