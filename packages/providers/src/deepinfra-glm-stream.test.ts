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
    ["wrong model", [chunk(), chunk({ model: "other-model" })]],
    ["mixed id", [chunk(), chunk({ id: "other-request" })]],
    ["wrong choice index", [chunk({ choices: [{ index: 1, delta: {}, finish_reason: null }] })]],
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
    ],
    ["post-terminal content", [chunk({ finish: "stop" }), chunk({ content: "late" })]],
    ["usage-only before terminal", [chunk({ choices: [], usage: { prompt_tokens: 1 } })]],
  ])("rejects %s chunks instead of combining them", async (_label, chunks) => {
    const fixture = harness(iterable(chunks as ChatCompletionChunk[]));
    await expect(fixture.adapter.execute(request())).rejects.toMatchObject({
      code: "invalid-response",
      retryable: false,
    });
    expect(fixture.create).toHaveBeenCalledTimes(1);
  });

  it("requires a terminal finish and rejects length-truncated output", async () => {
    const truncated = harness(iterable([chunk({ content: '{"answer":"ok"}' })]));
    await expect(truncated.adapter.execute(request())).rejects.toMatchObject({
      code: "invalid-response",
      diagnostics: [{ code: "incomplete_stream" }],
    });

    const limited = harness(iterable([chunk({ content: "{}", finish: "length" })]));
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

    const refusal = harness(iterable([chunk({ delta: { refusal: "no" }, finish: "stop" })]));
    await expect(refusal.adapter.execute(request())).rejects.toMatchObject({
      code: "invalid-response",
      diagnostics: [{ code: "refusal" }],
    });

    const invalidJson = harness(iterable([chunk({ content: '{"answer":1}', finish: "stop" })]));
    await expect(invalidJson.adapter.execute(request())).rejects.toMatchObject({
      code: "invalid-response",
      failureStage: "response-schema-validation",
    });
  });

  it("leaves usage unknown when a valid stream omits accounting metadata", async () => {
    const fixture = harness(iterable([chunk({ content: '{"answer":"ok"}', finish: "stop" })]));
    const result = await fixture.adapter.execute(request());
    expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });
    expect(result.cost.estimatedUsd).toBeNull();
  });
});
