import type { ModelSelection } from "@draft-loop/domain";
import type {
  JsonObject,
  ModelRequest,
  OpenAIClient,
  ProviderAdapterError,
} from "@draft-loop/providers";
import { describe, expect, it, vi } from "vitest";

import {
  createProviderAdapter,
  type ProviderClientFactories,
  type ProviderCredentialResolver,
} from "./local-provider-adapter.js";

const model: ModelSelection = {
  company: "openai",
  modelId: "gpt-test-exact",
  role: "critic",
  promptTemplateVersion: "critic-v1",
};

const profiledModel: ModelSelection = {
  ...model,
  profile: {
    id: "openai-critic",
    version: 1,
    provider: "openai",
    modelId: model.modelId,
    tier: "standard",
    roles: ["critic"],
    runtime: {
      effort: "high",
      maxOutputTokens: 4096,
      thinking: { mode: "provider-default" },
    },
    knownLimits: { maxOutputTokens: 8192, contextWindowTokens: 32768 },
  },
};

const request: ModelRequest<JsonObject> = {
  contextSnapshotId: "snapshot-1",
  model,
  systemPrompt: "Return the requested data as JSON.",
  input: { question: "What is the answer?" },
  outputSchema: {
    type: "object",
    properties: { answer: { type: "string" } },
    required: ["answer"],
    additionalProperties: false,
  },
  outputName: "answer_schema",
  dataPolicy: {
    allowTransmission: true,
    allowedCompanies: ["openai"],
    sensitiveData: false,
    sensitiveDataAcknowledged: false,
  },
};

function successResponse(): Awaited<ReturnType<OpenAIClient["responses"]["create"]>> {
  return {
    id: "response-1",
    object: "response",
    created_at: 1,
    status: "completed",
    error: null,
    incomplete_details: null,
    instructions: null,
    max_output_tokens: null,
    model: model.modelId,
    output: [
      {
        id: "message-1",
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: '{"answer":"yes"}', annotations: [] }],
      },
    ],
    output_text: '{"answer":"yes"}',
    parallel_tool_calls: true,
    previous_response_id: null,
    reasoning: { effort: null, summary: null },
    store: false,
    temperature: 1,
    text: { format: { type: "text" }, verbosity: "medium" },
    tool_choice: "auto",
    tools: [],
    top_p: 1,
    truncation: "disabled",
    usage: {
      input_tokens: 3,
      output_tokens: 2,
      total_tokens: 5,
      input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 0 },
    },
    user: null,
    metadata: {},
  } as unknown as Awaited<ReturnType<OpenAIClient["responses"]["create"]>>;
}

function apiHarness(create: OpenAIClient["responses"]["create"]) {
  const client: OpenAIClient = { responses: { create } };
  const factory = vi.fn(() => client);
  const factories: ProviderClientFactories = { openai: factory };
  const resolveCredential = vi.fn<ProviderCredentialResolver>(async () => "test-key");
  return { factories, factory, resolveCredential };
}

const retryableFailures = [
  ["timeout", Object.assign(new Error("request timed out"), { code: "ETIMEDOUT" })],
  ["server error", Object.assign(new Error("server failure"), { status: 503 })],
  [
    "short rate limit",
    Object.assign(new Error("too many requests"), {
      status: 429,
      headers: { "retry-after-ms": "5" },
    }),
  ],
] as const;

describe("application OpenAI API retry budget", () => {
  it.each(retryableFailures)(
    "makes one physical request by default after %s",
    async (_name, failure) => {
      const create = vi.fn<OpenAIClient["responses"]["create"]>(async () => {
        throw failure;
      });
      const harness = apiHarness(create);
      const adapter = await createProviderAdapter(
        {},
        model,
        true,
        harness.resolveCredential,
        harness.factories,
      );

      await expect(adapter.execute(request)).rejects.toMatchObject({ retryable: true });
      expect(create).toHaveBeenCalledTimes(1);
      expect(harness.factory).toHaveBeenCalledTimes(1);
    },
  );

  it("keeps a timing-only retry configuration but still defaults to one request", async () => {
    const sleep = vi.fn(async () => undefined);
    const create = vi.fn<OpenAIClient["responses"]["create"]>(async () => {
      throw Object.assign(new Error("request timed out"), { code: "ETIMEDOUT" });
    });
    const harness = apiHarness(create);
    const adapter = await createProviderAdapter(
      { retry: { baseDelayMs: 17, maxDelayMs: 29, sleep } },
      model,
      true,
      harness.resolveCredential,
      harness.factories,
    );

    await expect(adapter.execute(request)).rejects.toMatchObject({ code: "timeout" });
    expect(create).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("honors explicit retry count and timing options", async () => {
    const sleep = vi.fn(async (_delayMs: number) => undefined);
    const create = vi
      .fn<OpenAIClient["responses"]["create"]>()
      .mockRejectedValueOnce(Object.assign(new Error("request timed out"), { code: "ETIMEDOUT" }))
      .mockRejectedValueOnce(Object.assign(new Error("request timed out"), { code: "ETIMEDOUT" }))
      .mockResolvedValueOnce(successResponse());
    const harness = apiHarness(create);
    const adapter = await createProviderAdapter(
      { retry: { maxRetries: 2, baseDelayMs: 17, maxDelayMs: 29, sleep } },
      model,
      true,
      harness.resolveCredential,
      harness.factories,
    );

    const result = await adapter.execute(request);
    expect(result.output).toEqual({ answer: "yes" });
    expect(create).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    const firstDelay = sleep.mock.calls[0]?.[0];
    expect(firstDelay).toBeGreaterThanOrEqual(17);
    expect(firstDelay).toBeLessThanOrEqual(29);
    expect(sleep).toHaveBeenNthCalledWith(2, 29);
  });

  it.each([
    ["authentication", Object.assign(new Error("unauthorized"), { status: 401 })],
    ["quota", Object.assign(new Error("insufficient quota"), { status: 429 })],
  ] as const)("does not retry non-retryable %s failures", async (_name, failure) => {
    const sleep = vi.fn(async () => undefined);
    const create = vi.fn<OpenAIClient["responses"]["create"]>(async () => {
      throw failure;
    });
    const harness = apiHarness(create);
    const adapter = await createProviderAdapter(
      { retry: { maxRetries: 2, baseDelayMs: 17, maxDelayMs: 29, sleep } },
      model,
      true,
      harness.resolveCredential,
      harness.factories,
    );

    await expect(adapter.execute(request)).rejects.toMatchObject({ retryable: false });
    expect(create).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("preserves the successful OpenAI request parameters and parsed output", async () => {
    const profiledRequest: ModelRequest<JsonObject> = {
      ...request,
      model: profiledModel,
      maxOutputTokens: 4096,
    };
    const create = vi.fn<OpenAIClient["responses"]["create"]>(async (parameters) => {
      expect(parameters).toMatchObject({
        model: model.modelId,
        max_output_tokens: 4096,
        reasoning: { effort: "high" },
        instructions: request.systemPrompt,
        input: [
          { role: "user", content: [{ type: "input_text", text: JSON.stringify(request.input) }] },
        ],
        store: false,
        text: {
          format: {
            type: "json_schema",
            name: "answer_schema",
            schema: request.outputSchema,
            strict: true,
          },
        },
      });
      return successResponse();
    });
    const harness = apiHarness(create);
    const adapter = await createProviderAdapter(
      {},
      profiledModel,
      true,
      harness.resolveCredential,
      harness.factories,
    );

    await expect(adapter.execute(profiledRequest)).resolves.toMatchObject({
      output: { answer: "yes" },
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("does not resolve credentials or construct a client when transmission is denied", async () => {
    const create = vi.fn<OpenAIClient["responses"]["create"]>();
    const harness = apiHarness(create);
    await expect(
      createProviderAdapter({}, model, false, harness.resolveCredential, harness.factories),
    ).rejects.toMatchObject({ code: "policy" } satisfies Partial<ProviderAdapterError>);
    expect(harness.resolveCredential).not.toHaveBeenCalled();
    expect(harness.factory).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});
