import type { ModelSelection } from "@draft-loop/domain";
import type { ChatCompletionChunk } from "openai/resources/chat/completions";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DeepInfraGLMAdapter,
  type DeepInfraGLMClient,
  deepInfraGLMCompany,
  deepInfraGLMModelId,
  deepInfraGLMProvider,
  type ModelRequest,
} from "./index.js";

const outputSchema = {
  type: "object",
  properties: { answer: { type: "string" } },
  required: ["answer"],
  additionalProperties: false,
} as const;

const model: ModelSelection = {
  company: deepInfraGLMCompany,
  modelId: deepInfraGLMModelId,
  role: "author",
  promptTemplateVersion: "author-v1",
};

function request(signal?: AbortSignal): ModelRequest {
  return {
    contextSnapshotId: "snapshot-stream-1",
    model,
    systemPrompt: "Return one strict JSON object.",
    input: { question: "fixture" },
    outputSchema,
    outputName: "fixture_output",
    dataPolicy: {
      allowTransmission: true,
      allowedCompanies: ["deepinfra"],
      sensitiveData: false,
      sensitiveDataAcknowledged: false,
    },
    ...(signal === undefined ? {} : { signal }),
  };
}

function chunk(
  options: {
    readonly content?: string | null;
    readonly finish?: string | null;
    readonly model?: string;
    readonly id?: string;
    readonly choices?: unknown[];
    readonly usage?: unknown;
    readonly delta?: Record<string, unknown>;
  } = {},
): ChatCompletionChunk {
  return {
    id: options.id ?? "chatcmpl-stream",
    object: "chat.completion.chunk",
    created: 1,
    model: options.model ?? deepInfraGLMModelId,
    choices: options.choices ?? [
      {
        index: 0,
        delta: {
          ...(options.content === undefined ? {} : { content: options.content }),
          ...(options.delta ?? {}),
        },
        logprobs: null,
        finish_reason: options.finish ?? null,
      },
    ],
    ...(options.usage === undefined ? {} : { usage: options.usage }),
  } as unknown as ChatCompletionChunk;
}

function documentedChunk(options: {
  readonly omitId?: boolean;
  readonly id?: unknown;
  readonly model?: unknown;
  readonly created?: unknown;
  readonly choices: unknown[];
  readonly usage?: unknown;
}): ChatCompletionChunk {
  return {
    ...(options.omitId
      ? {}
      : { id: Object.hasOwn(options, "id") ? options.id : "chatcmpl-documented" }),
    object: "chat.completion.chunk",
    choices: options.choices,
    ...(Object.hasOwn(options, "model") ? { model: options.model } : {}),
    ...(Object.hasOwn(options, "created") ? { created: options.created } : {}),
    ...(Object.hasOwn(options, "usage") ? { usage: options.usage } : {}),
  } as unknown as ChatCompletionChunk;
}

function iterable(chunks: readonly ChatCompletionChunk[]): AsyncIterable<ChatCompletionChunk> {
  return {
    async *[Symbol.asyncIterator]() {
      yield* chunks;
    },
  };
}

function harness(
  response: PromiseLike<AsyncIterable<ChatCompletionChunk>> | AsyncIterable<ChatCompletionChunk>,
) {
  const create = vi.fn<DeepInfraGLMClient["chat"]["completions"]["create"]>(async () => response);
  const adapter = new DeepInfraGLMAdapter(
    { chat: { completions: { create } } },
    { configuredModel: model },
  );
  return { adapter, create };
}

afterEach(() => vi.useRealTimers());

describe("DeepInfra GLM streaming response", () => {
  it("accepts null role and tool placeholders around a structured single-choice response", async () => {
    const fixture = harness(
      iterable([
        chunk({ delta: { role: "assistant", tool_calls: null, function_call: null } }),
        chunk({ content: '{"answer":', delta: { role: null, tool_calls: null } }),
        chunk({ content: '"ok"}', delta: { role: null, function_call: null } }),
        chunk({
          finish: "stop",
          delta: { role: null, tool_calls: null, function_call: null },
          usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
        }),
        chunk({
          choices: [],
          usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
        }),
      ]),
    );

    const result = await fixture.adapter.execute(request());

    expect(result.output).toEqual({ answer: "ok" });
    expect(result.usage).toMatchObject({ inputTokens: 12, outputTokens: 3, totalTokens: 15 });
  });

  it("allows progressing output beyond the initial-response timeout", async () => {
    vi.useFakeTimers();
    const stream = {
      async *[Symbol.asyncIterator]() {
        yield chunk({ delta: { role: "assistant" } });
        await new Promise<void>((resolve) => setTimeout(resolve, 110_000));
        yield chunk({ content: '{"answer":' });
        await new Promise<void>((resolve) => setTimeout(resolve, 110_000));
        yield chunk({ content: '"ok"}' });
        yield chunk({ finish: "stop" });
      },
    };
    const fixture = harness(stream);
    const pending = fixture.adapter.execute(request());

    await vi.advanceTimersByTimeAsync(220_000);

    await expect(pending).resolves.toMatchObject({ output: { answer: "ok" } });
    expect(fixture.create).toHaveBeenCalledTimes(1);
    expect(fixture.create.mock.calls[0]?.[0]).toMatchObject({
      stream: true,
      stream_options: { include_usage: true },
    });
  });

  it("bounds a stalled initial response with allowlisted timeout diagnostics", async () => {
    vi.useFakeTimers();
    const fixture = harness(new Promise<AsyncIterable<ChatCompletionChunk>>(() => undefined));
    const pending = fixture.adapter.execute(request());
    const rejection = expect(pending).rejects.toMatchObject({
      provider: deepInfraGLMProvider,
      code: "timeout",
      retryable: true,
      diagnostics: [{ code: "stream_timeout_initial", path: "response.stream.initial" }],
    });

    await vi.advanceTimersByTimeAsync(120_000);
    await rejection;
    await expect(pending).rejects.toMatchObject({ diagnosticCounts: [] });
    expect(fixture.create).toHaveBeenCalledTimes(1);
    expect(fixture.create.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds a stalled next chunk and does not wait for iterator cleanup", async () => {
    vi.useFakeTimers();
    let nextCalls = 0;
    const returnPending = new Promise<IteratorResult<ChatCompletionChunk>>(() => undefined);
    const iterator = {
      next: vi.fn(() =>
        nextCalls++ === 0
          ? Promise.resolve({ done: false as const, value: chunk() })
          : returnPending,
      ),
      return: vi.fn(() => returnPending),
    };
    const fixture = harness({ [Symbol.asyncIterator]: () => iterator });
    const pending = fixture.adapter.execute(request());
    const rejection = expect(pending).rejects.toMatchObject({
      code: "timeout",
      diagnostics: [{ code: "stream_timeout_idle", path: "response.stream.idle" }],
    });

    await vi.advanceTimersByTimeAsync(120_000);
    await rejection;
    expect(iterator.next).toHaveBeenCalledTimes(2);
    expect(iterator.return).toHaveBeenCalledTimes(1);
  });

  it("enforces the total deadline even while chunks keep arriving", async () => {
    vi.useFakeTimers();
    const stream = {
      async *[Symbol.asyncIterator]() {
        for (let index = 0; index < 7; index += 1) {
          await new Promise<void>((resolve) => setTimeout(resolve, 100_000));
          yield chunk({ content: index === 0 ? "{" : "" });
        }
      },
    };
    const fixture = harness(stream);
    const pending = fixture.adapter.execute(request());
    const rejection = expect(pending).rejects.toMatchObject({
      code: "timeout",
      diagnostics: [{ code: "stream_timeout_total", path: "response.stream.total" }],
    });

    await vi.advanceTimersByTimeAsync(600_000);
    await rejection;
    expect(fixture.create).toHaveBeenCalledTimes(1);
  });

  it("counts reasoning deltas without storing them in the parsed output", async () => {
    const fixture = harness(
      iterable([
        chunk({ delta: { role: "assistant", reasoning_content: "think" } }),
        chunk({ content: '{"answer":', delta: { reasoning: "more" } }),
        chunk({ content: '"ok"}', delta: { reasoning_content: 42, reasoning: null } }),
        chunk({
          finish: "stop",
          usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
        }),
      ]),
    );

    const result = await fixture.adapter.execute(request());

    expect(result.output).toEqual({ answer: "ok" });
    expect(result.usage).toMatchObject({ inputTokens: 12, outputTokens: 3, totalTokens: 15 });
    expect(JSON.stringify(result)).not.toContain("think");
  });

  it("reports answer and reasoning volume when the stream goes idle", async () => {
    vi.useFakeTimers();
    let nextCalls = 0;
    const never = new Promise<IteratorResult<ChatCompletionChunk>>(() => undefined);
    const chunks = [
      chunk({ content: '{"ans', delta: { reasoning_content: "abc" } }),
      chunk({ delta: { reasoning: "de" } }),
    ];
    const iterator = {
      next: vi.fn(() => {
        const value = chunks[nextCalls++];
        return value === undefined ? never : Promise.resolve({ done: false as const, value });
      }),
      return: vi.fn(() => never),
    };
    const fixture = harness({ [Symbol.asyncIterator]: () => iterator });
    const pending = fixture.adapter.execute(request());
    const rejection = expect(pending).rejects.toMatchObject({
      code: "timeout",
      retryable: true,
      diagnostics: [{ code: "stream_timeout_idle", path: "response.stream.idle" }],
      diagnosticCounts: [
        { code: "stream_answer_characters", count: 5 },
        { code: "stream_reasoning_characters", count: 5 },
      ],
    });

    await vi.advanceTimersByTimeAsync(120_000);
    await rejection;
  });

  it("reports answer and reasoning volume when the total deadline is reached", async () => {
    vi.useFakeTimers();
    const stream = {
      async *[Symbol.asyncIterator]() {
        for (let index = 0; index < 7; index += 1) {
          await new Promise<void>((resolve) => setTimeout(resolve, 100_000));
          yield chunk({
            content: index === 0 ? "{" : "xy",
            delta: { reasoning_content: "r" },
          });
        }
      },
    };
    const fixture = harness(stream);
    const pending = fixture.adapter.execute(request());
    const rejection = expect(pending).rejects.toMatchObject({
      code: "timeout",
      diagnostics: [{ code: "stream_timeout_total", path: "response.stream.total" }],
      diagnosticCounts: [
        { code: "stream_answer_characters", count: 1 + 2 * 4 },
        { code: "stream_reasoning_characters", count: 5 },
      ],
    });

    await vi.advanceTimersByTimeAsync(600_000);
    await rejection;
  });

  it("aborts a pending next call promptly when the request is cancelled", async () => {
    let nextCalls = 0;
    const never = new Promise<IteratorResult<ChatCompletionChunk>>(() => undefined);
    const iterator = {
      next: vi.fn(() =>
        nextCalls++ === 0 ? Promise.resolve({ done: false as const, value: chunk() }) : never,
      ),
      return: vi.fn(async () => ({ done: true as const, value: undefined })),
    };
    const fixture = harness({ [Symbol.asyncIterator]: () => iterator });
    const controller = new AbortController();
    const pending = fixture.adapter.execute(request(controller.signal));
    await vi.waitFor(() => expect(iterator.next).toHaveBeenCalledTimes(2));
    controller.abort();

    await expect(pending).rejects.toMatchObject({
      code: "cancelled",
      retryable: false,
    });
    expect(iterator.return).toHaveBeenCalledTimes(1);
    const sdkSignal = fixture.create.mock.calls[0]?.[1]?.signal;
    expect(sdkSignal?.aborted).toBe(true);
  });

  it.each([
    ["wrong model", [chunk(), chunk({ model: "other-model" })], "stream_model_metadata"],
    ["mixed id", [chunk(), chunk({ id: "other-request" })], "stream_chunk_identity"],
    [
      "wrong choice index",
      [chunk({ choices: [{ index: 1, delta: {}, finish_reason: null }] })],
      "stream_choice_index",
    ],
    [
      "multiple choices",
      [
        chunk({
          choices: [
            { index: 0, delta: {}, finish_reason: null },
            { index: 0, delta: {}, finish_reason: null },
          ],
        }),
      ],
      "stream_choice_count",
    ],
    [
      "post-terminal content",
      [chunk({ finish: "stop" }), chunk({ content: "late" })],
      "stream_post_terminal_data",
    ],
    [
      "usage-only before terminal",
      [chunk({ choices: [], usage: { prompt_tokens: 1 } })],
      "stream_usage_sequence",
    ],
  ])("rejects %s chunks instead of combining them", async (_label, chunks, reason) => {
    const fixture = harness(iterable(chunks as ChatCompletionChunk[]));
    await expect(fixture.adapter.execute(request())).rejects.toMatchObject({
      code: "invalid-response",
      retryable: false,
      diagnostics: [{ code: "malformed_stream" }],
      diagnosticCounts: [{ code: reason, count: 1 }],
    });
    expect(fixture.create).toHaveBeenCalledTimes(1);
  });

  it("retains only the fixed reason count from a malformed private chunk", async () => {
    const privateStreamId = "private-stream-id";
    const privateModelName = "private-model-name";
    const privateCandidateContent = "private-candidate-content";
    const privateReasoningContent = "private-reasoning-content";
    const privateSourcePath = "private-source-path";
    const markers = [
      privateStreamId,
      privateModelName,
      privateCandidateContent,
      privateReasoningContent,
      privateSourcePath,
    ];
    const malformed = {
      ...chunk({
        id: privateStreamId,
        model: privateModelName,
        delta: {
          role: "user",
          content: privateCandidateContent,
          reasoning_content: privateReasoningContent,
        },
      }),
      sourcePath: privateSourcePath,
    } as unknown as ChatCompletionChunk;
    const fixture = harness(iterable([malformed]));

    let failure: unknown;
    try {
      await fixture.adapter.execute(request());
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      code: "invalid-response",
      diagnostics: [{ code: "malformed_stream", path: "response" }],
      diagnosticCounts: [{ code: "stream_model_metadata", count: 1 }],
    });
    for (const marker of markers) expect(JSON.stringify(failure)).not.toContain(marker);
    expect(fixture.create).toHaveBeenCalledTimes(1);
  });

  it("accepts documented chunks with omitted metadata and later supplied metadata", async () => {
    const fixture = harness(
      iterable([
        documentedChunk({
          choices: [{ delta: { content: '{"answer":"ok"}' }, finish_reason: null }],
        }),
        documentedChunk({
          model: deepInfraGLMModelId,
          created: 42,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
        }),
      ]),
    );

    const result = await fixture.adapter.execute(request());

    expect(result.output).toEqual({ answer: "ok" });
    expect(result.usage).toMatchObject({ inputTokens: 12, outputTokens: 3, totalTokens: 15 });
  });

  it("accepts varying fractional timestamps around a split strict JSON response", async () => {
    const fixture = harness(
      iterable([
        documentedChunk({
          created: 41.5,
          choices: [{ delta: { content: '{"answer":' }, finish_reason: null }],
        }),
        documentedChunk({
          model: deepInfraGLMModelId,
          created: 42.25,
          choices: [{ index: 0, delta: { content: '"ok"}' }, finish_reason: null }],
        }),
        documentedChunk({
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
        }),
      ]),
    );

    const result = await fixture.adapter.execute(request());

    expect(result.output).toEqual({ answer: "ok" });
    expect(result.usage).toMatchObject({ inputTokens: 12, outputTokens: 3, totalTokens: 15 });
    expect(result).not.toHaveProperty("created");
  });

  it("uses the explicit request model when every chunk omits model metadata", async () => {
    const fixture = harness(
      iterable([
        documentedChunk({
          choices: [{ delta: { content: '{"answer":"ok"}' }, finish_reason: null }],
        }),
        documentedChunk({
          choices: [{ delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
        }),
      ]),
    );

    await expect(fixture.adapter.execute(request())).resolves.toMatchObject({
      output: { answer: "ok" },
      modelId: deepInfraGLMModelId,
      usage: { inputTokens: 12, outputTokens: 3, totalTokens: 15 },
    });
  });

  it.each([
    ["missing identity", { omitId: true }, "stream_chunk_identity"],
    ["null identity", { id: null }, "stream_chunk_identity"],
    ["blank identity", { id: "   " }, "stream_chunk_identity"],
    ["null model", { model: null }, "stream_model_metadata"],
    ["wrong model", { model: "other-model" }, "stream_model_metadata"],
    ["null timestamp", { created: null }, "stream_timestamp_metadata"],
    ["undefined timestamp", { created: undefined }, "stream_timestamp_metadata"],
    ["invalid timestamp", { created: "not-a-time" }, "stream_timestamp_metadata"],
    ["object timestamp", { created: {} }, "stream_timestamp_metadata"],
    ["array timestamp", { created: [] }, "stream_timestamp_metadata"],
    ["NaN timestamp", { created: Number.NaN }, "stream_timestamp_metadata"],
    ["infinite timestamp", { created: Number.POSITIVE_INFINITY }, "stream_timestamp_metadata"],
    ["negative timestamp", { created: -1 }, "stream_timestamp_metadata"],
    ["oversized timestamp", { created: Number.MAX_SAFE_INTEGER + 1 }, "stream_timestamp_metadata"],
    [
      "null index",
      { choices: [{ index: null, delta: {}, finish_reason: "stop" }] },
      "stream_choice_index",
    ],
    [
      "wrong index",
      { choices: [{ index: 1, delta: {}, finish_reason: "stop" }] },
      "stream_choice_index",
    ],
  ])("rejects malformed supplied metadata: %s", async (_label, metadata, reason) => {
    const options = {
      choices: [{ delta: { content: '{"answer":"ok"}' }, finish_reason: "stop" }],
      ...metadata,
    } as Parameters<typeof documentedChunk>[0];
    const fixture = harness(iterable([documentedChunk(options)]));

    await expect(fixture.adapter.execute(request())).rejects.toMatchObject({
      code: "invalid-response",
      diagnostics: [{ code: "malformed_stream" }],
      diagnosticCounts: [{ code: reason, count: 1 }],
    });
    expect(fixture.create).toHaveBeenCalledTimes(1);
  });

  it("keeps completion identity and model checks with varying valid timestamps", async () => {
    const inconsistentId = harness(
      iterable([
        documentedChunk({
          id: "completion-a",
          created: 41.5,
          choices: [{ delta: { content: '{"answer":"ok"}' }, finish_reason: null }],
        }),
        documentedChunk({
          id: "completion-b",
          created: 42.25,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        }),
      ]),
    );
    await expect(inconsistentId.adapter.execute(request())).rejects.toMatchObject({
      code: "invalid-response",
      diagnostics: [{ code: "malformed_stream" }],
      diagnosticCounts: [{ code: "stream_chunk_identity", count: 1 }],
    });

    const inconsistentModel = harness(
      iterable([
        documentedChunk({
          model: deepInfraGLMModelId,
          created: 41.5,
          choices: [{ delta: { content: '{"answer":"ok"}' }, finish_reason: null }],
        }),
        documentedChunk({
          model: "other-model",
          created: 42.25,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        }),
      ]),
    );
    await expect(inconsistentModel.adapter.execute(request())).rejects.toMatchObject({
      code: "invalid-response",
      diagnostics: [{ code: "malformed_stream" }],
      diagnosticCounts: [{ code: "stream_model_metadata", count: 1 }],
    });
  });

  it("still rejects invalid structured JSON with varying valid timestamps", async () => {
    const fixture = harness(
      iterable([
        documentedChunk({
          created: 41.5,
          choices: [{ delta: { content: '{"answer":' }, finish_reason: null }],
        }),
        documentedChunk({
          created: 42.25,
          choices: [{ index: 0, delta: { content: '"unterminated"' }, finish_reason: "stop" }],
        }),
      ]),
    );

    await expect(fixture.adapter.execute(request())).rejects.toMatchObject({
      code: "invalid-response",
      diagnostics: [{ code: "invalid_json" }],
    });
    expect(fixture.create).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["tool-call array", { tool_calls: [{ index: 0 }] }, "stream_tool_data"],
    ["empty tool-call array", { tool_calls: [] }, "stream_tool_data"],
    ["function-call object", { function_call: { name: "lookup" } }, "stream_tool_data"],
    ["non-assistant role", { role: "user" }, "stream_role"],
    ["malformed role", { role: { name: "assistant" } }, "stream_role"],
    ["invalid content type", { content: 42 }, "stream_content_type"],
    ["invalid refusal type", { refusal: 42 }, "stream_refusal_type"],
  ])(
    "rejects %s despite null placeholders otherwise being allowed",
    async (_label, delta, reason) => {
      const fixture = harness(iterable([chunk({ delta })]));

      await expect(fixture.adapter.execute(request())).rejects.toMatchObject({
        code: "invalid-response",
        diagnostics: [{ code: "malformed_stream" }],
        diagnosticCounts: [{ code: reason, count: 1 }],
      });
      expect(fixture.create).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ["non-object chunk", null, "stream_chunk_envelope"],
    ["invalid object marker", { ...chunk(), object: "wrong" }, "stream_chunk_envelope"],
    ["invalid choices field", { ...chunk(), choices: null }, "stream_chunk_envelope"],
    ["invalid choice shape", chunk({ choices: [null] }), "stream_choice_shape"],
    ["invalid delta type", chunk({ choices: [{ index: 0, delta: null }] }), "stream_delta_type"],
    [
      "invalid finish marker",
      chunk({ choices: [{ index: 0, delta: {}, finish_reason: 42 }] }),
      "stream_finish_marker",
    ],
  ])("counts the fixed reason for %s", async (_label, value, reason) => {
    const fixture = harness(iterable([value as ChatCompletionChunk]));
    await expect(fixture.adapter.execute(request())).rejects.toMatchObject({
      code: "invalid-response",
      diagnostics: [{ code: "malformed_stream" }],
      diagnosticCounts: [{ code: reason, count: 1 }],
    });
    expect(fixture.create).toHaveBeenCalledTimes(1);
  });

  it("requires a terminal finish and rejects length-truncated output", async () => {
    const truncated = harness(iterable([chunk({ content: '{"answer":"ok"}' })]));
    await expect(truncated.adapter.execute(request())).rejects.toMatchObject({
      code: "invalid-response",
      diagnostics: [{ code: "incomplete_stream" }],
    });

    const limited = harness(
      iterable([
        chunk({
          content: "{}",
          finish: "length",
          delta: { role: null, tool_calls: null, function_call: null },
        }),
      ]),
    );
    await expect(limited.adapter.execute(request())).rejects.toMatchObject({
      code: "invalid-response",
      failureStage: "output-token-budget-exceeded",
    });
  });

  it("accepts final usage-only chunks and discards reasoning deltas", async () => {
    const fixture = harness(
      iterable([
        chunk({
          content: '{"answer":"ok"}',
          delta: { reasoning_content: "private reasoning must not be retained" },
        }),
        chunk({ finish: "stop" }),
        chunk({
          choices: [],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 40,
            total_tokens: 140,
            completion_tokens_details: { reasoning_tokens: 15 },
          },
        }),
      ]),
    );

    const result = await fixture.adapter.execute(request());

    expect(result.output).toEqual({ answer: "ok" });
    expect(result.usage).toMatchObject({
      inputTokens: 100,
      outputTokens: 40,
      reasoningOutputTokens: 15,
    });
    expect(JSON.stringify(result)).not.toContain("reasoning_content");
    expect(JSON.stringify(result)).not.toContain("private reasoning");
  });

  it("bounds buffered UTF-8 JSON and preserves refusal and schema validation", async () => {
    const oversized = harness(iterable([chunk({ content: "x".repeat(8 * 1024 * 1024 + 1) })]));
    await expect(oversized.adapter.execute(request())).rejects.toMatchObject({
      code: "invalid-response",
      diagnostics: [{ code: "output_too_large" }],
    });

    const refusal = harness(
      iterable([
        chunk({
          delta: { role: null, tool_calls: null, function_call: null, refusal: "no" },
          finish: "stop",
        }),
      ]),
    );
    await expect(refusal.adapter.execute(request())).rejects.toMatchObject({
      code: "invalid-response",
      diagnostics: [{ code: "refusal" }],
    });

    const invalidJson = harness(
      iterable([
        chunk({
          content: '{"answer":1}',
          finish: "stop",
          delta: { role: null, tool_calls: null, function_call: null },
        }),
      ]),
    );
    await expect(invalidJson.adapter.execute(request())).rejects.toMatchObject({
      code: "invalid-response",
      failureStage: "response-schema-validation",
    });

    const malformedJson = harness(
      iterable([
        chunk({
          content: '{"answer":',
          finish: "stop",
          delta: { role: null, tool_calls: null, function_call: null },
        }),
      ]),
    );
    await expect(malformedJson.adapter.execute(request())).rejects.toMatchObject({
      code: "invalid-response",
      diagnostics: [{ code: "invalid_json" }],
    });
  });

  it("leaves usage unknown when a valid stream omits accounting metadata", async () => {
    const fixture = harness(iterable([chunk({ content: '{"answer":"ok"}', finish: "stop" })]));
    const result = await fixture.adapter.execute(request());
    expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });
    expect(result.cost.estimatedUsd).toBeNull();
  });
});
