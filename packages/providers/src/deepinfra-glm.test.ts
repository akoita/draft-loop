import type { ModelSelection } from "@draft-loop/domain";
import {
  authorArtifactProposalJsonSchemaForEvidence,
  canonicalCandidateProfileExtractionProposalJsonSchema,
} from "@draft-loop/schemas";
import type OpenAI from "openai";
import type { ChatCompletion } from "openai/resources/chat/completions";
import { describe, expect, it, vi } from "vitest";
import {
  createDeepInfraGLMClient,
  DeepInfraGLMAdapter,
  type DeepInfraGLMClient,
  type DeepInfraGLMRequestOptions,
  deepInfraGLMBaseUrl,
  deepInfraGLMCompany,
  deepInfraGLMModelId,
  deepInfraGLMProvider,
  type JsonObject,
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
  allowedCompanies: ["deepinfra"],
  sensitiveData: true,
  sensitiveDataAcknowledged: true,
} as const;

function selection(
  options: {
    readonly profile?: ModelSelection["profile"];
    readonly modelId?: string;
    readonly company?: string;
    readonly role?: "author" | "critic";
    readonly promptTemplateVersion?: string;
  } = {},
): ModelSelection {
  return {
    company: options.company ?? deepInfraGLMCompany,
    modelId: options.modelId ?? deepInfraGLMModelId,
    role: options.role ?? "critic",
    promptTemplateVersion: options.promptTemplateVersion ?? "critic-v1",
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
    readonly roles?: readonly ("author" | "critic")[];
  } = {},
): NonNullable<ModelSelection["profile"]> {
  const maxTokens = options.maxOutputTokens ?? 8192;
  const thinking = options.thinking ?? "provider-default";
  return {
    id: "glm-flash-critic",
    version: 1,
    provider: options.provider ?? deepInfraGLMCompany,
    modelId: options.modelId ?? deepInfraGLMModelId,
    tier: "standard",
    roles: options.roles ?? ["critic"],
    runtime: {
      effort: options.effort ?? "low",
      maxOutputTokens: maxTokens,
      thinking:
        thinking === "budgeted" ? { mode: "budgeted", maxTokens: 2048 } : { mode: thinking },
    },
    knownLimits: { maxOutputTokens: 131_072, contextWindowTokens: 200_000 },
  };
}

function request(model = selection(), overrides: Partial<ModelRequest> = {}): ModelRequest {
  return {
    contextSnapshotId: "snapshot-glm-1",
    model,
    systemPrompt: "Return one strict JSON object.",
    input: { question: "fixture" },
    outputSchema: jsonSchema,
    outputName: "fixture_output",
    dataPolicy: policy,
    ...overrides,
  };
}

function completion(
  options: {
    readonly content?: string | null;
    readonly finishReason?: string | null;
    readonly model?: string;
    readonly refusal?: string | null;
    readonly usage?: unknown;
  } = {},
): ChatCompletion {
  return {
    id: "chatcmpl-fixture",
    choices: [
      {
        index: 0,
        finish_reason: options.finishReason === undefined ? "stop" : options.finishReason,
        logprobs: null,
        message: {
          role: "assistant",
          content: options.content === undefined ? '{"answer":"ok"}' : options.content,
          refusal: options.refusal ?? null,
          reasoning_content: "must not be retained",
        },
      },
    ],
    created: 1,
    model: options.model ?? deepInfraGLMModelId,
    object: "chat.completion",
    usage:
      options.usage === undefined
        ? {
            prompt_tokens: 100,
            completion_tokens: 40,
            total_tokens: 140,
            prompt_tokens_details: { cached_tokens: 20, cache_write_tokens: 10 },
            completion_tokens_details: { reasoning_tokens: 15 },
          }
        : options.usage,
  } as unknown as ChatCompletion;
}

type CreateCompletion = DeepInfraGLMClient["chat"]["completions"]["create"];

function harness(
  options: {
    readonly response?: ChatCompletion;
    readonly configuredModel?: ModelSelection;
    readonly retry?: {
      readonly maxRetries?: number;
      readonly sleep?: (ms: number) => Promise<void>;
    };
    readonly timeoutMs?: number;
  } = {},
) {
  const create = vi.fn<CreateCompletion>(async () => options.response ?? completion());
  const client: DeepInfraGLMClient = { chat: { completions: { create } } };
  const adapter = new DeepInfraGLMAdapter(client, {
    configuredModel: options.configuredModel ?? selection(),
    ...(options.retry === undefined ? {} : { retry: options.retry }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    pricing: {
      inputUsdPerMillionTokens: 2,
      outputUsdPerMillionTokens: 10,
      cachedInputUsdPerMillionTokens: 1,
      cacheWriteInputUsdPerMillionTokens: 4,
    },
  });
  return { adapter, create };
}

describe("DeepInfra GLM-5.3-Flash adapter", () => {
  it("constructs the fixed host with SDK retries disabled and a bounded default timeout", () => {
    const client = createDeepInfraGLMClient("synthetic-key") as OpenAI;
    expect(client.baseURL).toBe(deepInfraGLMBaseUrl);
    expect(client.maxRetries).toBe(0);
    expect(client.timeout).toBe(120_000);
    expect(() => createDeepInfraGLMClient("key", { timeoutMs: 0 })).toThrow(ProviderAdapterError);
    expect(() => createDeepInfraGLMClient("key", { timeoutMs: Number.POSITIVE_INFINITY })).toThrow(
      ProviderAdapterError,
    );
  });

  it("sends the exact Chat Completions JSON-schema request and returns parsed output", async () => {
    const { adapter, create } = harness();
    const result = await adapter.execute(request());
    expect(create).toHaveBeenCalledTimes(1);
    const [parameters, options] = create.mock.calls[0] ?? [];
    expect(parameters).toMatchObject({
      model: "zai-org/GLM-5.3-Flash",
      max_tokens: 4096,
      n: 1,
      messages: [
        { role: "system", content: "Return one strict JSON object." },
        { role: "user", content: '{"question":"fixture"}' },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "fixture_output", schema: jsonSchema, strict: true },
      },
      stream: true,
      stream_options: { include_usage: true },
    });
    expect(parameters).not.toHaveProperty("reasoning_effort");
    expect(parameters).not.toHaveProperty("max_completion_tokens");
    expect(options).toMatchObject({ maxRetries: 0, timeout: 120_000 });
    expect(result).toMatchObject({
      output: { answer: "ok" },
      contextSnapshotId: "snapshot-glm-1",
      provider: "deepinfra",
      company: "zai",
      modelId: deepInfraGLMModelId,
      providerRequestId: "chatcmpl-fixture",
      usage: {
        inputTokens: 100,
        outputTokens: 40,
        totalTokens: 140,
        cachedInputTokens: 20,
        cacheWriteInputTokens: 10,
        reasoningOutputTokens: 15,
      },
      cost: { estimatedUsd: 0.0006 },
    });
    expect(JSON.stringify(result)).not.toContain("reasoning_content");
  });

  it.each(["low", "high", "max"] as const)(
    "forwards profile effort %s and exact profile budget",
    async (effort) => {
      const selectedProfile = profile({ effort, maxOutputTokens: 9000 });
      const model = selection({ profile: selectedProfile });
      const { adapter, create } = harness({ configuredModel: model });
      await adapter.execute(request(model));
      expect(create.mock.calls[0]?.[0]).toMatchObject({
        max_tokens: 9000,
        reasoning_effort: effort,
      });
    },
  );

  it("omits provider-default effort and rejects unsupported profile controls before calling", async () => {
    const providerDefaultModel = selection({ profile: profile({ effort: "provider-default" }) });
    const { adapter, create } = harness({ configuredModel: providerDefaultModel });
    await adapter.execute(request(providerDefaultModel));
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty("reasoning_effort");

    for (const invalidProfile of [
      profile({ effort: "medium" }),
      profile({ thinking: "disabled" }),
      profile({ thinking: "budgeted" }),
    ]) {
      const invalidModel = selection({ profile: invalidProfile });
      const fixture = harness({ configuredModel: invalidModel });
      await expect(fixture.adapter.execute(request(invalidModel))).rejects.toMatchObject({
        code: "invalid-request",
        retryable: false,
      });
      expect(fixture.create).not.toHaveBeenCalled();
    }
  });

  it("rejects model, role, prompt, and profile drift before provider calls", async () => {
    const configured = selection({ profile: profile() });
    const drifted = [
      selection({ profile: profile(), modelId: "other-model" }),
      selection({ profile: profile({ roles: ["author"] }) }),
      selection({ profile: profile(), promptTemplateVersion: "critic-v2" }),
      selection({ profile: profile({ effort: "high" }) }),
    ];
    for (const requested of drifted) {
      const fixture = harness({ configuredModel: configured });
      await expect(fixture.adapter.execute(request(requested))).rejects.toMatchObject({
        code: "invalid-request",
        retryable: false,
      });
      expect(fixture.create).not.toHaveBeenCalled();
    }
  });

  it("rejects mismatched profile budgets and output caps before provider calls", async () => {
    const selectedProfile = profile({ maxOutputTokens: 8192 });
    const model = selection({ profile: selectedProfile });
    const mismatch = harness({ configuredModel: model });
    await expect(
      mismatch.adapter.execute(request(model, { maxOutputTokens: 4096 })),
    ).rejects.toMatchObject({ code: "invalid-request" });
    expect(mismatch.create).not.toHaveBeenCalled();

    for (const budget of [0, 131_073, Number.MAX_SAFE_INTEGER + 1]) {
      const fixture = harness();
      await expect(
        fixture.adapter.execute(request(selection(), { maxOutputTokens: budget })),
      ).rejects.toMatchObject({ code: "invalid-request" });
      expect(fixture.create).not.toHaveBeenCalled();
    }
  });

  it("requires DeepInfra hosting approval rather than company or OpenAI approval", async () => {
    for (const allowedCompanies of [["zai"], ["openai"]] as const) {
      const fixture = harness();
      await expect(
        fixture.adapter.execute(
          request(selection(), { dataPolicy: { ...policy, allowedCompanies } }),
        ),
      ).rejects.toMatchObject({ provider: deepInfraGLMProvider, code: "policy" });
      expect(fixture.create).not.toHaveBeenCalled();
    }
  });

  it.each([
    ["length", "output-token-budget-exceeded"],
    ["tool_calls", "transport-parsing"],
    ["function_call", "transport-parsing"],
    ["content_filter", "transport-parsing"],
    [null, "transport-parsing"],
  ] as const)("fails closed for finish reason %s", async (finishReason, failureStage) => {
    const fixture = harness({ response: completion({ finishReason }) });
    await expect(fixture.adapter.execute(request())).rejects.toMatchObject({
      code: "invalid-response",
      retryable: false,
      failureStage,
    });
  });

  it("rejects refusals, empty content, invalid JSON, and schema violations", async () => {
    const cases = [
      completion({ refusal: "refused" }),
      completion({ content: null }),
      completion({ content: "not json" }),
      completion({ content: '{"answer":"ok","extra":true}' }),
    ];
    for (const response of cases) {
      const fixture = harness({ response });
      await expect(fixture.adapter.execute(request())).rejects.toMatchObject({
        provider: deepInfraGLMProvider,
        code: "invalid-response",
        retryable: false,
      });
      expect(fixture.create).toHaveBeenCalledTimes(1);
    }
  });

  it("rejects a response from a different model", async () => {
    const fixture = harness({ response: completion({ model: "unexpected-model" }) });
    await expect(fixture.adapter.execute(request())).rejects.toMatchObject({
      code: "invalid-response",
      failureStage: "transport-parsing",
      retryable: false,
    });
    expect(fixture.create).toHaveBeenCalledTimes(1);
  });

  it("rejects an uncompileable output schema before making a provider call", async () => {
    const circularSchema: Record<string, unknown> = { type: "object" };
    circularSchema.$defs = circularSchema;
    const fixture = harness();
    await expect(
      fixture.adapter.execute(
        request(selection(), { outputSchema: circularSchema as unknown as JsonObject }),
      ),
    ).rejects.toMatchObject({ code: "invalid-request", retryable: false });
    expect(fixture.create).not.toHaveBeenCalled();
  });

  it("rejects unsupported conditional schemas before making a provider call", async () => {
    const fixture = harness();
    const conditionalSchema = JSON.parse(
      '{"type":"object","if":{"required":["answer"]},"then":{"properties":{"answer":{"type":"string"}}}}',
    ) as JsonObject;
    await expect(
      fixture.adapter.execute(request(selection(), { outputSchema: conditionalSchema })),
    ).rejects.toMatchObject({ code: "invalid-request", retryable: false });
    expect(fixture.create).not.toHaveBeenCalled();
  });

  it("validates production extraction and revision schemas without transforming output", async () => {
    for (const outputSchema of [
      canonicalCandidateProfileExtractionProposalJsonSchema,
      authorArtifactProposalJsonSchemaForEvidence(["chunk-1"]),
    ]) {
      const fixture = harness({ response: completion({ content: "{}" }) });
      await expect(
        fixture.adapter.execute(
          request(selection(), { outputSchema: outputSchema as unknown as JsonObject }),
        ),
      ).rejects.toMatchObject({
        code: "invalid-response",
        failureStage: "response-schema-validation",
      });
      expect(fixture.create).toHaveBeenCalledTimes(1);
    }

    const schemaWithDefault = {
      type: "object",
      properties: {
        answer: { type: "string" },
        default: { type: "string", default: "named-property-must-remain-absent" },
        label: { type: "string", default: "provider-default-must-not-appear" },
      },
      required: ["answer"],
      additionalProperties: false,
    } as const;
    const fixture = harness({
      response: completion({ content: '{"answer":"kept","default":"explicit-field"}' }),
    });
    const result = await fixture.adapter.execute(
      request(selection(), { outputSchema: schemaWithDefault }),
    );
    expect(result.output).toEqual({ answer: "kept", default: "explicit-field" });
    expect(fixture.create.mock.calls[0]?.[0].response_format).toEqual({
      type: "json_schema",
      json_schema: {
        name: "fixture_output",
        schema: schemaWithDefault,
        strict: true,
      },
    });
  });

  it("does not let a default annotation satisfy a missing required output field", async () => {
    const requiredDefaultSchema = {
      type: "object",
      properties: {
        answer: { type: "string" },
        requiredLabel: { type: "string", default: "must-not-be-injected" },
      },
      required: ["answer", "requiredLabel"],
      additionalProperties: false,
    } as const;
    const fixture = harness({ response: completion({ content: '{"answer":"kept"}' }) });
    await expect(
      fixture.adapter.execute(request(selection(), { outputSchema: requiredDefaultSchema })),
    ).rejects.toMatchObject({
      code: "invalid-response",
      failureStage: "response-schema-validation",
      retryable: false,
    });
    expect(fixture.create).toHaveBeenCalledTimes(1);
    expect(fixture.create.mock.calls[0]?.[0].response_format).toEqual({
      type: "json_schema",
      json_schema: {
        name: "fixture_output",
        schema: requiredDefaultSchema,
        strict: true,
      },
    });
  });

  it("reports only fixed top-level schema reason counts for invalid output", async () => {
    const outputSchema = {
      type: "object",
      properties: {
        candidateName: { type: "string" },
        disposition: { type: "string", enum: ["approved"] },
      },
      required: ["candidateName", "disposition"],
      additionalProperties: false,
    } as const;
    const fixture = harness({
      response: completion({
        content:
          '{"candidateName":7,"disposition":"private-enum-value","arbitrary-private-key":"candidate text"}',
      }),
    });
    let caught: unknown;
    try {
      await fixture.adapter.execute(
        request(selection(), { outputSchema: outputSchema as unknown as JsonObject }),
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      code: "invalid-response",
      failureStage: "response-schema-validation",
      diagnostics: [{ code: "output_schema_mismatch", path: "response" }],
      diagnosticCounts: expect.arrayContaining([
        { code: "profile_output_invalid_type", count: 1 },
        { code: "profile_output_invalid_value", count: 1 },
        { code: "profile_output_unrecognized_keys", count: 1 },
      ]),
    });
    const errorText = JSON.stringify(caught);
    expect(errorText).not.toContain("private-enum-value");
    expect(errorText).not.toContain("arbitrary-private-key");
    expect(errorText).not.toContain("candidate text");
    expect(errorText).not.toContain("candidateName");
    expect(errorText).not.toContain("disposition");
    expect(fixture.create).toHaveBeenCalledTimes(1);
  });

  it("maps cache and reasoning details without double counting and keeps unknown cost unknown", async () => {
    const fixture = harness();
    const result = await fixture.adapter.execute(request());
    expect(result.usage).toEqual({
      inputTokens: 100,
      outputTokens: 40,
      totalTokens: 140,
      cachedInputTokens: 20,
      cacheWriteInputTokens: 10,
      reasoningOutputTokens: 15,
    });
    expect(result.cost.estimatedUsd).toBe(0.0006);

    const unknownUsage = harness({ response: completion({ usage: null }) });
    const unknown = await unknownUsage.adapter.execute(request());
    expect(unknown.usage).toEqual({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });
    expect(unknown.cost.estimatedUsd).toBeNull();

    const inconsistentUsage = harness({
      response: completion({
        usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 139 },
      }),
    });
    const inconsistent = await inconsistentUsage.adapter.execute(request());
    expect(inconsistent.usage.totalTokens).toBe(140);
    expect(inconsistent.cost.estimatedUsd).toBeNull();
  });

  it("forwards abort signal and enforces a single SDK attempt by default", async () => {
    const fixture = harness({
      response: completion(),
      timeoutMs: 25_000,
    });
    const controller = new AbortController();
    await fixture.adapter.execute(request(selection(), { signal: controller.signal }));
    const options = fixture.create.mock.calls[0]?.[1] as DeepInfraGLMRequestOptions | undefined;
    expect(options).toMatchObject({ maxRetries: 0, timeout: 25_000 });
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(options?.signal).not.toBe(controller.signal);
    expect(options?.signal?.aborted).toBe(true);

    const failing = vi.fn<CreateCompletion>(async () => {
      throw Object.assign(new Error("private failure detail"), { status: 503 });
    });
    const client: DeepInfraGLMClient = { chat: { completions: { create: failing } } };
    const adapter = new DeepInfraGLMAdapter(client, { configuredModel: selection() });
    await expect(adapter.execute(request())).rejects.toMatchObject({
      code: "transient",
      retryable: true,
    });
    expect(failing).toHaveBeenCalledTimes(1);
    await expect(
      adapter.execute(request(selection(), { signal: AbortSignal.abort() })),
    ).rejects.toMatchObject({
      code: "cancelled",
      retryable: false,
    });
    expect(failing).toHaveBeenCalledTimes(1);
  });

  it("honors bounded explicit retries and ignores retries for quota/auth failures", async () => {
    const sleep = vi.fn(async () => undefined);
    const transient = vi
      .fn<CreateCompletion>()
      .mockRejectedValueOnce(Object.assign(new Error("temporary"), { status: 503 }))
      .mockRejectedValueOnce(Object.assign(new Error("temporary"), { status: 503 }))
      .mockResolvedValueOnce(completion());
    const client: DeepInfraGLMClient = { chat: { completions: { create: transient } } };
    const adapter = new DeepInfraGLMAdapter(client, {
      configuredModel: selection(),
      retry: { maxRetries: 2, sleep },
    });
    await adapter.execute(request());
    expect(transient).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);

    expect(
      () =>
        new DeepInfraGLMAdapter(client, { configuredModel: selection(), retry: { maxRetries: 3 } }),
    ).toThrow(ProviderAdapterError);
    for (const failure of [
      Object.assign(new Error("billing"), { status: 402 }),
      Object.assign(new Error("insufficient_quota private"), {
        status: 429,
        code: "insufficient_quota",
      }),
      Object.assign(new Error("unauthorized"), { status: 401 }),
    ]) {
      const create = vi.fn<CreateCompletion>(async () => {
        throw failure;
      });
      const retryClient: DeepInfraGLMClient = { chat: { completions: { create } } };
      const retrySleep = vi.fn(async () => undefined);
      const retryAdapter = new DeepInfraGLMAdapter(retryClient, {
        configuredModel: selection(),
        retry: { maxRetries: 2, sleep: retrySleep },
      });
      const error = await retryAdapter.execute(request()).catch((value: unknown) => value);
      expect(error).toBeInstanceOf(ProviderAdapterError);
      expect((error as ProviderAdapterError).retryable).toBe(false);
      expect((error as Error).message).not.toContain("private");
      expect(create).toHaveBeenCalledTimes(1);
      expect(retrySleep).not.toHaveBeenCalled();
    }
  });

  it.each([
    ["authentication", Object.assign(new Error("auth"), { status: 401 }), false],
    ["rate limit", Object.assign(new Error("slow down"), { status: 429 }), true],
    ["timeout", Object.assign(new Error("timed out"), { name: "APIConnectionTimeoutError" }), true],
    ["server", Object.assign(new Error("temporary"), { status: 503 }), true],
  ] as const)("safely normalizes %s errors", async (_name, failure, retryable) => {
    const create = vi.fn<CreateCompletion>(async () => {
      throw failure;
    });
    const client: DeepInfraGLMClient = { chat: { completions: { create } } };
    const adapter = new DeepInfraGLMAdapter(client, { configuredModel: selection() });
    const error = await adapter.execute(request()).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(ProviderAdapterError);
    expect((error as ProviderAdapterError).retryable).toBe(retryable);
    expect((error as Error).message).not.toContain("temporary");
  });
});
