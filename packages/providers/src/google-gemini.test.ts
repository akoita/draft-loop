import type { ModelSelection } from "@draft-loop/domain";
import { ApiError, type GenerateContentParameters } from "@google/genai";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createGoogleGeminiAdapter,
  createGoogleGeminiClient,
  GoogleGeminiAdapter,
  type GoogleGeminiClient,
  googleGeminiBaseUrl,
  googleGeminiCompany,
  googleGeminiModelId,
  googleGeminiProvider,
  type ModelRequest,
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
  allowedCompanies: ["google"],
  sensitiveData: true,
  sensitiveDataAcknowledged: true,
} as const;

function selection(
  options: {
    readonly profile?: ModelSelection["profile"];
    readonly modelId?: string;
    readonly company?: string;
    readonly role?: "author" | "critic";
  } = {},
): ModelSelection {
  return {
    company: options.company ?? googleGeminiCompany,
    modelId: options.modelId ?? googleGeminiModelId,
    role: options.role ?? "critic",
    promptTemplateVersion: "critic-v1",
    ...(options.profile === undefined ? {} : { profile: options.profile }),
  };
}

function profile(
  options: {
    readonly effort?: "low" | "medium" | "high" | "max" | "provider-default";
    readonly thinking?: "provider-default" | "disabled" | "budgeted";
    readonly maxOutputTokens?: number;
    readonly modelId?: string;
    readonly provider?: string;
  } = {},
): NonNullable<ModelSelection["profile"]> {
  const thinking = options.thinking ?? "provider-default";
  return {
    id: "gemini-flash-critic",
    version: 1,
    provider: options.provider ?? googleGeminiCompany,
    modelId: options.modelId ?? googleGeminiModelId,
    tier: "standard",
    roles: ["critic"],
    runtime: {
      effort: options.effort ?? "provider-default",
      maxOutputTokens: options.maxOutputTokens ?? 8192,
      thinking:
        thinking === "budgeted" ? { mode: "budgeted", maxTokens: 2048 } : { mode: thinking },
    },
    knownLimits: { maxOutputTokens: 65_536, contextWindowTokens: 1_000_000 },
  };
}

function request(model = selection(), overrides: Partial<ModelRequest> = {}): ModelRequest {
  return {
    contextSnapshotId: "snapshot-gemini-1",
    model,
    systemPrompt: "Return one strict JSON object.",
    input: { question: "fixture" },
    outputSchema: jsonSchema,
    outputName: "fixture_output",
    dataPolicy: policy,
    ...overrides,
  };
}

interface ChunkOptions {
  readonly text?: string;
  readonly thought?: string;
  readonly finish?: string;
  readonly modelVersion?: string;
  readonly responseId?: string;
  readonly usage?: unknown;
  readonly promptFeedback?: unknown;
  readonly parts?: unknown[];
  readonly candidates?: unknown[];
}

function chunk(options: ChunkOptions = {}): unknown {
  const parts = options.parts ?? [
    ...(options.thought === undefined ? [] : [{ text: options.thought, thought: true }]),
    ...(options.text === undefined ? [] : [{ text: options.text }]),
  ];
  return {
    ...(options.candidates === undefined && options.promptFeedback !== undefined
      ? {}
      : {
          candidates: options.candidates ?? [
            {
              content: { role: "model", parts },
              ...(options.finish === undefined ? {} : { finishReason: options.finish }),
            },
          ],
        }),
    ...(options.modelVersion === undefined ? {} : { modelVersion: options.modelVersion }),
    responseId: options.responseId ?? "response-1",
    ...(options.usage === undefined ? {} : { usageMetadata: options.usage }),
    ...(options.promptFeedback === undefined ? {} : { promptFeedback: options.promptFeedback }),
  };
}

function iterable(chunks: readonly unknown[]): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      yield* chunks;
    },
  };
}

function validStream(extra: ChunkOptions = {}): AsyncIterable<unknown> {
  return iterable([
    chunk({ text: '{"answer":' }),
    chunk({ text: '"ok"}', finish: "STOP", ...extra }),
  ]);
}

type GenerateStream = GoogleGeminiClient["models"]["generateContentStream"];

function harness(
  response: PromiseLike<AsyncIterable<unknown>> | AsyncIterable<unknown>,
  options: ConstructorParameters<typeof GoogleGeminiAdapter>[1] = {
    configuredModel: selection(),
  },
) {
  const generate = vi.fn<GenerateStream>(async () => response);
  const adapter = new GoogleGeminiAdapter({ models: { generateContentStream: generate } }, options);
  return { adapter, generate };
}

function apiError(status: number, message = "provider detail"): ApiError {
  return new ApiError({ message, status });
}

function sentParameters(generate: ReturnType<typeof vi.fn<GenerateStream>>) {
  const parameters = generate.mock.calls[0]?.[0] as GenerateContentParameters;
  expect(parameters).toBeDefined();
  return parameters;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Google Gemini adapter", () => {
  it("maps a request onto one structured streaming call", async () => {
    const fixture = harness(validStream());

    const result = await fixture.adapter.execute(request());

    expect(fixture.generate).toHaveBeenCalledTimes(1);
    const parameters = sentParameters(fixture.generate);
    expect(parameters.model).toBe("gemini-3.7-flash");
    expect(parameters.contents).toEqual([
      { role: "user", parts: [{ text: JSON.stringify({ question: "fixture" }) }] },
    ]);
    expect(parameters.config).toMatchObject({
      systemInstruction: "Return one strict JSON object.",
      responseMimeType: "application/json",
      responseJsonSchema: jsonSchema,
      maxOutputTokens: 4096,
      candidateCount: 1,
    });
    expect(parameters.config?.responseSchema).toBeUndefined();
    expect(parameters.config?.thinkingConfig).toBeUndefined();
    expect(parameters.config?.abortSignal).toBeInstanceOf(AbortSignal);
    expect(result).toMatchObject({
      output: { answer: "ok" },
      provider: googleGeminiProvider,
      company: googleGeminiCompany,
      modelId: googleGeminiModelId,
      providerRequestId: "response-1",
      contextSnapshotId: "snapshot-gemini-1",
    });
    expect(result.structuredOutputSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(
      createGoogleGeminiAdapter(
        { models: { generateContentStream: vi.fn() } },
        {
          configuredModel: selection(),
        },
      ),
    ).toBeInstanceOf(GoogleGeminiAdapter);
  });

  it("emits started and completed progress", async () => {
    const onProgress = vi.fn();
    const fixture = harness(
      validStream({ usage: { promptTokenCount: 4, candidatesTokenCount: 2 } }),
    );

    await fixture.adapter.execute(request(selection(), { onProgress }));

    expect(onProgress).toHaveBeenNthCalledWith(1, { stage: "started", elapsedMs: 0 });
    expect(onProgress).toHaveBeenLastCalledWith(
      expect.objectContaining({ stage: "completed", tokensObserved: 6 }),
    );
  });

  it("uses the profile output budget and turns thinking off for disabled thinking", async () => {
    const model = selection({ profile: profile({ thinking: "disabled", maxOutputTokens: 2048 }) });
    const fixture = harness(validStream(), { configuredModel: model });

    await fixture.adapter.execute(request(model, { maxOutputTokens: 2048 }));

    const config = sentParameters(fixture.generate).config;
    expect(config?.maxOutputTokens).toBe(2048);
    expect(config?.thinkingConfig).toEqual({ thinkingBudget: 0 });
  });

  it.each([
    ["low", "LOW"],
    ["high", "HIGH"],
  ] as const)("maps %s effort to the thinking level", async (effort, level) => {
    const model = selection({ profile: profile({ effort }) });
    const fixture = harness(validStream(), { configuredModel: model });

    await fixture.adapter.execute(request(model));

    expect(sentParameters(fixture.generate).config?.thinkingConfig).toEqual({
      thinkingLevel: level,
    });
  });

  it("never requests thought text", async () => {
    const model = selection({ profile: profile({ effort: "high" }) });
    const fixture = harness(validStream(), { configuredModel: model });

    await fixture.adapter.execute(request(model));

    expect(JSON.stringify(sentParameters(fixture.generate))).not.toContain("includeThoughts");
  });

  it("excludes thought parts from the answer and never stores them", async () => {
    const fixture = harness(
      iterable([
        chunk({ thought: "private reasoning" }),
        chunk({ text: '{"answer":"ok"}', thought: "more reasoning" }),
        chunk({ finish: "STOP", usage: { promptTokenCount: 5, candidatesTokenCount: 3 } }),
      ]),
    );

    const result = await fixture.adapter.execute(request());

    expect(result.output).toEqual({ answer: "ok" });
    expect(JSON.stringify(result)).not.toContain("reasoning");
  });

  it("accepts documented model-version suffixes and rejects other models", async () => {
    const accepted = harness(validStream({ modelVersion: "gemini-3.7-flash-001" }));
    await expect(accepted.adapter.execute(request())).resolves.toMatchObject({
      modelId: googleGeminiModelId,
    });

    for (const modelVersion of ["gemini-3.7-flash2", "gemini-3.7-pro", "other"]) {
      const rejected = harness(validStream({ modelVersion }));
      await expect(rejected.adapter.execute(request())).rejects.toMatchObject({
        code: "invalid-response",
        retryable: false,
        diagnostics: [{ code: "unexpected_response_model", path: "response" }],
      });
    }
  });

  it("rejects invalid JSON without retrying", async () => {
    const fixture = harness(iterable([chunk({ text: "{not json", finish: "STOP" })]), {
      configuredModel: selection(),
      retry: { maxRetries: 2, sleep: vi.fn(async () => undefined) },
    });

    await expect(fixture.adapter.execute(request())).rejects.toMatchObject({
      code: "invalid-response",
      retryable: false,
      failureStage: "transport-parsing",
      diagnostics: [{ code: "invalid_json", path: "response" }],
    });
    expect(fixture.generate).toHaveBeenCalledTimes(1);
  });

  it("sends Gemini a schema without item counts while local validation keeps them", async () => {
    const countedSchema = {
      type: "object",
      properties: {
        items: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 2 },
        maxItems: { type: "string" },
      },
      required: ["items", "maxItems"],
      additionalProperties: false,
    };
    const original = JSON.stringify(countedSchema);
    const accepted = harness(
      iterable([chunk({ text: '{"items":["a"],"maxItems":"x"}', finish: "STOP" })]),
    );

    await accepted.adapter.execute(request(selection(), { outputSchema: countedSchema }));

    expect(sentParameters(accepted.generate).config?.responseJsonSchema).toEqual({
      type: "object",
      properties: {
        items: { type: "array", items: { type: "string" } },
        maxItems: { type: "string" },
      },
      required: ["items", "maxItems"],
      additionalProperties: false,
    });
    expect(JSON.stringify(countedSchema)).toBe(original);

    const tooMany = harness(
      iterable([chunk({ text: '{"items":["a","b","c"],"maxItems":"x"}', finish: "STOP" })]),
    );
    await expect(
      tooMany.adapter.execute(request(selection(), { outputSchema: countedSchema })),
    ).rejects.toMatchObject({ failureStage: "response-schema-validation" });
  });

  it("rejects schema mismatches with content-free issue counts", async () => {
    const fixture = harness(
      iterable([chunk({ text: '{"answer":42,"secret":"value"}', finish: "STOP" })]),
    );

    const error = await fixture.adapter.execute(request()).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(ProviderAdapterError);
    expect(error).toMatchObject({
      code: "invalid-response",
      failureStage: "response-schema-validation",
      diagnostics: [{ code: "output_schema_mismatch", path: "response" }],
    });
    expect(JSON.stringify((error as ProviderAdapterError).diagnosticCounts)).not.toContain(
      "secret",
    );
    expect((error as ProviderAdapterError).diagnosticCounts.length).toBeGreaterThan(0);
  });

  it("rejects an empty answer", async () => {
    const fixture = harness(iterable([chunk({ parts: [], finish: "STOP" })]));

    await expect(fixture.adapter.execute(request())).rejects.toMatchObject({
      code: "invalid-response",
      diagnostics: [{ code: "missing_output", path: "response" }],
    });
  });

  it("reports the output-token budget stage for MAX_TOKENS", async () => {
    const fixture = harness(iterable([chunk({ text: '{"answer":"tru', finish: "MAX_TOKENS" })]));

    await expect(fixture.adapter.execute(request())).rejects.toMatchObject({
      code: "invalid-response",
      retryable: false,
      failureStage: "output-token-budget-exceeded",
      diagnostics: [{ code: "output_token_limit_reached", path: "response" }],
    });
  });

  it.each(["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII"])(
    "maps the %s finish reason to a refusal",
    async (finish) => {
      const fixture = harness(iterable([chunk({ parts: [], finish })]));

      await expect(fixture.adapter.execute(request())).rejects.toMatchObject({
        code: "invalid-response",
        retryable: false,
        diagnostics: [{ code: "refusal", path: "response" }],
      });
    },
  );

  it.each([
    ["OTHER", [chunk({ text: '{"answer":"ok"}', finish: "OTHER" })]],
    ["a missing finish reason", [chunk({ text: '{"answer":"ok"}' })]],
    ["an empty stream", []],
  ])("treats %s as an incomplete response", async (_name, chunks) => {
    const fixture = harness(iterable(chunks));

    await expect(fixture.adapter.execute(request())).rejects.toMatchObject({
      code: "invalid-response",
      retryable: false,
      diagnostics: [{ code: "incomplete_response", path: "response" }],
    });
  });

  it("rejects a blocked prompt without retrying", async () => {
    const fixture = harness(
      iterable([chunk({ promptFeedback: { blockReason: "PROHIBITED_CONTENT" } })]),
      {
        configuredModel: selection(),
        retry: { maxRetries: 2, sleep: vi.fn(async () => undefined) },
      },
    );

    await expect(fixture.adapter.execute(request())).rejects.toMatchObject({
      code: "invalid-response",
      retryable: false,
      diagnostics: [{ code: "prompt_blocked", path: "response" }],
    });
    expect(fixture.generate).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["multiple candidates", chunk({ candidates: [{}, {}] })],
    ["a tool call part", chunk({ parts: [{ functionCall: { name: "run" } }] })],
    ["a non-object chunk", "text"],
    ["a non-string text part", chunk({ parts: [{ text: 42 }] })],
  ])("rejects a stream with %s as malformed", async (_name, malformed) => {
    const fixture = harness(iterable([malformed]));

    await expect(fixture.adapter.execute(request())).rejects.toMatchObject({
      code: "invalid-response",
      retryable: false,
      diagnostics: [{ code: "malformed_stream", path: "response" }],
    });
  });

  it("rejects answer text after the terminal chunk", async () => {
    const fixture = harness(
      iterable([chunk({ text: '{"answer":"ok"}', finish: "STOP" }), chunk({ text: "extra" })]),
    );

    await expect(fixture.adapter.execute(request())).rejects.toMatchObject({
      diagnostics: [{ code: "malformed_stream", path: "response" }],
    });
  });

  it("rejects oversized answers", async () => {
    const big = "x".repeat(1024 * 1024);
    const fixture = harness(
      iterable([
        ...Array.from({ length: 9 }, () => chunk({ text: big })),
        chunk({ finish: "STOP" }),
      ]),
    );

    await expect(fixture.adapter.execute(request())).rejects.toMatchObject({
      diagnostics: [{ code: "output_too_large", path: "response" }],
    });
  });
});

describe("Google Gemini usage accounting", () => {
  const pricing = { inputUsdPerMillionTokens: 1, outputUsdPerMillionTokens: 4 };

  it("counts thought tokens once as output and cached tokens as input", async () => {
    const fixture = harness(
      validStream({
        usage: {
          promptTokenCount: 1000,
          cachedContentTokenCount: 200,
          candidatesTokenCount: 30,
          thoughtsTokenCount: 70,
          totalTokenCount: 1100,
        },
      }),
      {
        configuredModel: selection(),
        pricing: { ...pricing, cachedInputUsdPerMillionTokens: 0.25 },
      },
    );

    const result = await fixture.adapter.execute(request());

    expect(result.usage).toEqual({
      inputTokens: 1000,
      outputTokens: 100,
      totalTokens: 1100,
      cachedInputTokens: 200,
      reasoningOutputTokens: 70,
    });
    expect(result.cost.estimatedUsd).toBeCloseTo((800 * 1 + 200 * 0.25 + 100 * 4) / 1_000_000, 10);
  });

  it("uses the latest cumulative usage metadata", async () => {
    const fixture = harness(
      iterable([
        chunk({ text: '{"answer":"ok"}', usage: { promptTokenCount: 5, candidatesTokenCount: 1 } }),
        chunk({ finish: "STOP", usage: { promptTokenCount: 5, candidatesTokenCount: 4 } }),
      ]),
      { configuredModel: selection(), pricing },
    );

    const result = await fixture.adapter.execute(request());

    expect(result.usage).toMatchObject({ inputTokens: 5, outputTokens: 4, totalTokens: 9 });
    expect(result.cost.estimatedUsd).toBeCloseTo((5 + 16) / 1_000_000, 10);
  });

  it("keeps unknown usage and cost honest", async () => {
    const missing = harness(validStream(), { configuredModel: selection(), pricing });
    await expect(missing.adapter.execute(request())).resolves.toMatchObject({
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      cost: { estimatedUsd: null },
    });

    const noPricing = harness(
      validStream({ usage: { promptTokenCount: 3, candidatesTokenCount: 2 } }),
    );
    await expect(noPricing.adapter.execute(request())).resolves.toMatchObject({
      usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
      cost: { estimatedUsd: null },
    });

    const invalid = harness(
      validStream({
        usage: { promptTokenCount: 3, candidatesTokenCount: 2, thoughtsTokenCount: -1 },
      }),
      { configuredModel: selection(), pricing },
    );
    await expect(invalid.adapter.execute(request())).resolves.toMatchObject({
      cost: { estimatedUsd: null },
    });
  });
});

describe("Google Gemini request controls", () => {
  it.each([
    ["a different model", selection({ modelId: "gemini-3.7-pro" })],
    ["a different company", selection({ company: "openai" })],
    ["a different role", selection({ role: "author" })],
  ])("rejects %s than the configured model", async (_name, requested) => {
    const fixture = harness(validStream());

    await expect(fixture.adapter.execute(request(requested))).rejects.toMatchObject({
      code: "invalid-request",
      retryable: false,
      diagnostics: [{ code: "model_mismatch", path: "request" }],
    });
    expect(fixture.generate).not.toHaveBeenCalled();
  });

  it("rejects a configured model that is not Gemini 3.7 Flash", async () => {
    const wrong = selection({ modelId: "gemini-3.7-pro" });
    const fixture = harness(validStream(), { configuredModel: wrong });

    await expect(fixture.adapter.execute(request(wrong))).rejects.toMatchObject({
      diagnostics: [{ code: "model_mismatch", path: "request" }],
    });
  });

  it.each([
    ["a profile for another model", profile({ modelId: "gemini-3.7-pro" }), "model_mismatch"],
    ["a profile for another provider", profile({ provider: "openai" }), "model_mismatch"],
    ["budgeted thinking", profile({ thinking: "budgeted" }), "unsupported_thinking"],
    [
      "disabled thinking with explicit effort",
      profile({ thinking: "disabled", effort: "low" }),
      "unsupported_thinking",
    ],
    ["max effort", profile({ effort: "max" }), "unsupported_effort"],
    ["medium effort", profile({ effort: "medium" }), "unsupported_effort"],
    ["an oversized budget", profile({ maxOutputTokens: 65_537 }), "model_mismatch"],
  ])("rejects %s", async (_name, selectedProfile, code) => {
    const model = selection({ profile: selectedProfile });
    const fixture = harness(validStream(), { configuredModel: model });

    await expect(fixture.adapter.execute(request(model))).rejects.toMatchObject({
      code: "invalid-request",
      retryable: false,
      diagnostics: [{ code, path: "request" }],
    });
    expect(fixture.generate).not.toHaveBeenCalled();
  });

  it("accepts the model maximum output budget and rejects a mismatched request budget", async () => {
    const model = selection({ profile: profile({ maxOutputTokens: 65_536 }) });
    const fixture = harness(validStream(), { configuredModel: model });
    await fixture.adapter.execute(request(model));
    expect(sentParameters(fixture.generate).config?.maxOutputTokens).toBe(65_536);

    await expect(
      fixture.adapter.execute(request(model, { maxOutputTokens: 4096 })),
    ).rejects.toMatchObject({
      diagnostics: [{ code: "profile_budget_mismatch", path: "request" }],
    });
  });

  it.each([0, -1, 1.5, 65_537])("rejects the output budget %s", async (maxOutputTokens) => {
    const fixture = harness(validStream());

    await expect(
      fixture.adapter.execute(request(selection(), { maxOutputTokens })),
    ).rejects.toMatchObject({
      diagnostics: [{ code: "invalid_output_token_budget", path: "request" }],
    });
  });

  it("rejects requests when the data policy does not allow Google", async () => {
    const fixture = harness(validStream());

    await expect(
      fixture.adapter.execute(
        request(selection(), { dataPolicy: { ...policy, allowedCompanies: ["anthropic"] } }),
      ),
    ).rejects.toMatchObject({ code: "policy", retryable: false });
    await expect(
      fixture.adapter.execute(
        request(selection(), { dataPolicy: { ...policy, allowTransmission: false } }),
      ),
    ).rejects.toMatchObject({ code: "policy" });
    await expect(
      fixture.adapter.execute(
        request(selection(), { dataPolicy: { ...policy, sensitiveDataAcknowledged: false } }),
      ),
    ).rejects.toMatchObject({ code: "policy" });
    expect(fixture.generate).not.toHaveBeenCalled();
  });

  it("rejects unsupported schemas and invalid adapter options", async () => {
    const fixture = harness(validStream());
    await expect(
      fixture.adapter.execute(request(selection(), { outputSchema: { type: "bogus" } })),
    ).rejects.toMatchObject({ diagnostics: [{ code: "unsupported_output_schema" }] });

    const client = { models: { generateContentStream: vi.fn<GenerateStream>() } };
    expect(
      () => new GoogleGeminiAdapter(client, { configuredModel: selection(), timeoutMs: 0 }),
    ).toThrow(ProviderAdapterError);
    expect(
      () =>
        new GoogleGeminiAdapter(client, {
          configuredModel: selection(),
          retry: { maxRetries: 3 },
        }),
    ).toThrow(ProviderAdapterError);
  });
});

describe("Google Gemini streaming deadlines", () => {
  it("bounds a stalled initial response", async () => {
    vi.useFakeTimers();
    const fixture = harness(new Promise<AsyncIterable<unknown>>(() => undefined));
    const pending = fixture.adapter.execute(request());
    const rejection = expect(pending).rejects.toMatchObject({
      provider: googleGeminiProvider,
      code: "timeout",
      retryable: true,
      diagnostics: [{ code: "stream_timeout_initial", path: "response.stream.initial" }],
    });

    await vi.advanceTimersByTimeAsync(120_000);
    await rejection;
    expect(sentParameters(fixture.generate).config?.abortSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("allows progressing output beyond the initial-response timeout", async () => {
    vi.useFakeTimers();
    const stream = {
      async *[Symbol.asyncIterator]() {
        yield chunk({ text: '{"answer":' });
        await new Promise<void>((resolve) => setTimeout(resolve, 110_000));
        yield chunk({ text: '"ok"}' });
        await new Promise<void>((resolve) => setTimeout(resolve, 110_000));
        yield chunk({ finish: "STOP" });
      },
    };
    const fixture = harness(stream);
    const pending = fixture.adapter.execute(request());

    await vi.advanceTimersByTimeAsync(220_000);

    await expect(pending).resolves.toMatchObject({ output: { answer: "ok" } });
    expect(fixture.generate).toHaveBeenCalledTimes(1);
  });

  it("reports answer and reasoning volume when the stream goes idle", async () => {
    vi.useFakeTimers();
    let nextCalls = 0;
    const never = new Promise<IteratorResult<unknown>>(() => undefined);
    const chunks = [chunk({ text: '{"ans', thought: "abc" }), chunk({ thought: "de" })];
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
    expect(iterator.return).toHaveBeenCalledTimes(1);
  });

  it("enforces the total deadline and reports answer and reasoning volume", async () => {
    vi.useFakeTimers();
    const stream = {
      async *[Symbol.asyncIterator]() {
        for (let index = 0; index < 7; index += 1) {
          await new Promise<void>((resolve) => setTimeout(resolve, 100_000));
          yield chunk({ text: index === 0 ? "{" : "xy", thought: "r" });
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
    expect(fixture.generate).toHaveBeenCalledTimes(1);
  });
});

describe("Google Gemini cancellation and errors", () => {
  it("rejects an already aborted request and aborts an in-flight stream", async () => {
    const aborted = harness(validStream());
    await expect(
      aborted.adapter.execute(request(selection(), { signal: AbortSignal.abort() })),
    ).rejects.toMatchObject({ code: "cancelled", retryable: false });
    expect(aborted.generate).not.toHaveBeenCalled();

    const controller = new AbortController();
    const fixture = harness(new Promise<AsyncIterable<unknown>>(() => undefined));
    const pending = fixture.adapter.execute(request(selection(), { signal: controller.signal }));
    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: "cancelled", retryable: false });
    expect(sentParameters(fixture.generate).config?.abortSignal?.aborted).toBe(true);
  });

  function failingHarness(failure: unknown, maxRetries = 2) {
    const sleep = vi.fn(async () => undefined);
    const generate = vi.fn<GenerateStream>(async () => {
      throw failure;
    });
    const adapter = new GoogleGeminiAdapter(
      { models: { generateContentStream: generate } },
      { configuredModel: selection(), retry: { maxRetries, sleep } },
    );
    return { adapter, generate, sleep };
  }

  it.each([
    [400, "invalid-request"],
    [401, "authentication"],
    [403, "permission"],
  ] as const)("does not retry a %s response", async (status, code) => {
    const fixture = failingHarness(apiError(status));

    await expect(fixture.adapter.execute(request())).rejects.toMatchObject({
      provider: googleGeminiProvider,
      code,
      status,
      retryable: false,
    });
    expect(fixture.generate).toHaveBeenCalledTimes(1);
    expect(fixture.sleep).not.toHaveBeenCalled();
  });

  it("classifies a rejected API key reported as 400 as authentication", async () => {
    const fixture = failingHarness(
      apiError(400, "API key not valid. Please pass a valid API key."),
    );

    await expect(fixture.adapter.execute(request())).rejects.toMatchObject({
      code: "authentication",
      retryable: false,
    });
  });

  it("reports an unavailable model without retrying", async () => {
    const fixture = failingHarness(apiError(404, "models/gemini-3.7-flash is not found"));

    await expect(fixture.adapter.execute(request())).rejects.toMatchObject({
      code: "invalid-request",
      status: 404,
      retryable: false,
      diagnostics: [{ code: "model_unavailable", path: "error" }],
    });
    expect(fixture.generate).toHaveBeenCalledTimes(1);
  });

  it("retries rate limits within the cap and then surfaces them", async () => {
    const fixture = failingHarness(apiError(429, "Resource has been exhausted (e.g. check quota)"));

    await expect(fixture.adapter.execute(request())).rejects.toMatchObject({
      code: "rate-limit",
      status: 429,
      retryable: true,
    });
    expect(fixture.generate).toHaveBeenCalledTimes(3);
    expect(fixture.sleep).toHaveBeenCalledTimes(2);
  });

  it.each([
    "You exceeded your current quota, please check your plan and billing details.",
    "Your prepayment credits are depleted. Please go to AI Studio.",
    "Your project has exceeded its monthly spending cap.",
  ])("treats quota exhaustion as non-retryable: %s", async (message) => {
    const fixture = failingHarness(apiError(429, message));

    const error = await fixture.adapter.execute(request()).catch((value: unknown) => value);

    expect(error).toMatchObject({
      code: "quota-exhausted",
      status: 429,
      retryable: false,
      diagnostics: [{ code: "account_quota_unavailable", path: "error" }],
    });
    expect((error as ProviderAdapterError).message).not.toContain("prepayment");
    expect(fixture.generate).toHaveBeenCalledTimes(1);
    expect(fixture.sleep).not.toHaveBeenCalled();
  });

  it("retries a transient server error and then succeeds", async () => {
    const sleep = vi.fn(async () => undefined);
    const generate = vi
      .fn<GenerateStream>()
      .mockRejectedValueOnce(apiError(503, "overloaded"))
      .mockResolvedValueOnce(validStream());
    const adapter = new GoogleGeminiAdapter(
      { models: { generateContentStream: generate } },
      { configuredModel: selection(), retry: { maxRetries: 2, sleep } },
    );

    await expect(adapter.execute(request())).resolves.toMatchObject({ output: { answer: "ok" } });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("normalizes a mid-stream API error without leaking its message", async () => {
    const stream = {
      async *[Symbol.asyncIterator]() {
        yield chunk({ text: "partial candidate content" });
        throw apiError(500, "secret provider body with prompt text");
      },
    };
    const fixture = harness(stream);

    const error = await fixture.adapter.execute(request()).catch((value: unknown) => value);

    expect(error).toMatchObject({ code: "transient", status: 500, retryable: true });
    expect(JSON.stringify(error)).not.toContain("secret");
    expect((error as Error).message).not.toContain("secret");
    expect((error as Error).message).not.toContain("partial");
  });

  it("never copies keys, prompts, or candidate text into surfaced errors", async () => {
    const fixture = failingHarness(
      apiError(400, "bad request for key AIza-secret and prompt fixture text"),
      0,
    );

    const error = await fixture.adapter.execute(request()).catch((value: unknown) => value);

    expect((error as Error).message).not.toContain("AIza");
    expect(JSON.stringify(error)).not.toContain("fixture text");
  });
});

describe("Google Gemini client", () => {
  it("pins the Gemini API endpoint, disables SDK retries, and ignores redirecting environment", async () => {
    vi.stubEnv("GOOGLE_GEMINI_BASE_URL", "https://attacker.example/");
    vi.stubEnv("GOOGLE_GENAI_USE_VERTEXAI", "true");
    const fetchMock = vi.fn(
      async (_url: unknown, _init?: unknown) =>
        new Response(JSON.stringify({ error: { code: 503, message: "unavailable" } }), {
          status: 503,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createGoogleGeminiClient("test-key-not-real");
    await expect(
      client.models.generateContentStream({
        model: googleGeminiModelId,
        contents: [{ role: "user", parts: [{ text: "{}" }] }],
      }),
    ).rejects.toMatchObject({ status: 503 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url.startsWith(googleGeminiBaseUrl)).toBe(true);
    expect(url).toContain(`models/${googleGeminiModelId}:streamGenerateContent`);
    expect(url).not.toContain("attacker");
  });
});
