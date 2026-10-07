import type { AgentRole, ModelSelection } from "@draft-loop/domain";
import type {
  ModelProfile,
  ModelProfileEffort,
  ModelProfileThinking,
} from "@draft-loop/domain/model-profile";
import { describe, expect, it, vi } from "vitest";
import {
  AnthropicAdapter,
  type AnthropicClient,
  type ModelRequest,
  OpenAIAdapter,
  type OpenAIClient,
  ProviderAdapterError,
} from "./index.js";

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

function profile(
  provider: "anthropic" | "openai",
  role: AgentRole,
  options: {
    readonly id?: string;
    readonly modelId?: string;
    readonly roles?: readonly AgentRole[];
    readonly effort?: ModelProfileEffort;
    readonly thinking?: ModelProfileThinking;
    readonly maxOutputTokens?: number;
    readonly knownMaxOutputTokens?: number;
  } = {},
): ModelProfile {
  const maxOutputTokens = options.maxOutputTokens ?? 4096;
  return {
    id: options.id ?? `${provider}-${role}`,
    version: 1,
    provider,
    modelId: options.modelId ?? `${provider}-test-model`,
    tier: "standard",
    roles: options.roles ?? [role],
    runtime: {
      effort: options.effort ?? "provider-default",
      maxOutputTokens,
      thinking: options.thinking ?? { mode: "provider-default" },
    },
    knownLimits: {
      maxOutputTokens: options.knownMaxOutputTokens ?? 8192,
      contextWindowTokens: 32768,
    },
  };
}

function selection(
  selectedProfile: ModelProfile,
  role: AgentRole = selectedProfile.roles[0] ?? "author",
  modelId = selectedProfile.modelId,
): ModelSelection {
  return {
    company: selectedProfile.provider,
    modelId,
    role,
    promptTemplateVersion: `${role}-v1`,
    profile: selectedProfile,
  };
}

function request(model: ModelSelection, maxOutputTokens?: number): ModelRequest {
  return {
    contextSnapshotId: "snapshot-profile-test",
    model,
    systemPrompt: "Return a JSON answer.",
    input: { question: "What is the answer?" },
    outputSchema: schema,
    outputName: "answer_schema",
    dataPolicy: policy,
    ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
  };
}

function anthropicFixture() {
  type Params = Parameters<AnthropicClient["messages"]["create"]>[0];
  const response = {
    content: [{ type: "text", text: '{"answer":"yes"}' }],
    stop_reason: "end_turn",
    usage: { input_tokens: 1, output_tokens: 1 },
  };
  let seen: Params | undefined;
  const create = vi.fn((parameters: Params) => {
    seen = parameters;
    return Promise.resolve(response) as ReturnType<AnthropicClient["messages"]["create"]>;
  });
  const client = { messages: { create } } as unknown as AnthropicClient;
  return {
    client,
    create,
    get seen() {
      return seen;
    },
  };
}

function openAIFixture() {
  type Params = Parameters<OpenAIClient["responses"]["create"]>[0];
  let seen: Params | undefined;
  const create = vi.fn((parameters: Params) => {
    seen = parameters;
    return Promise.resolve({
      output_text: '{"answer":"yes"}',
      usage: { input_tokens: 1, output_tokens: 1 },
    }) as unknown as ReturnType<OpenAIClient["responses"]["create"]>;
  });
  const client = { responses: { create } } as unknown as OpenAIClient;
  return {
    client,
    create,
    get seen() {
      return seen;
    },
  };
}

async function capturedError(action: () => Promise<unknown>): Promise<unknown> {
  try {
    await action();
  } catch (error) {
    return error;
  }
  throw new Error("Expected provider request to be rejected.");
}

describe("profile runtime controls at provider adapters", () => {
  it.each([
    {
      name: "omits provider-default overrides",
      effort: "provider-default" as const,
      thinking: { mode: "provider-default" } as const,
      expectedEffort: undefined,
      expectedThinking: undefined,
    },
    {
      name: "maps disabled thinking and explicit effort",
      effort: "low" as const,
      thinking: { mode: "disabled" } as const,
      expectedEffort: "low",
      expectedThinking: { type: "disabled" },
    },
    {
      name: "maps a valid budgeted thinking allowance",
      effort: "xhigh" as const,
      thinking: { mode: "budgeted", maxTokens: 1024 } as const,
      expectedEffort: "xhigh",
      expectedThinking: { type: "enabled", budget_tokens: 1024 },
    },
  ])("Anthropic $name", async ({ effort, thinking, expectedEffort, expectedThinking }) => {
    const selectedProfile = profile("anthropic", "author", {
      effort,
      thinking,
      maxOutputTokens: 4096,
    });
    const selected = selection(selectedProfile);
    const fixture = anthropicFixture();
    const adapter = new AnthropicAdapter(fixture.client, { configuredModel: selected });

    await adapter.execute(request(selected, 4096));

    expect(fixture.seen).toMatchObject({
      model: selected.modelId,
      max_tokens: 4096,
      output_config: { format: { type: "json_schema", schema } },
    });
    expect(fixture.seen?.output_config).toEqual({
      ...(expectedEffort === undefined ? {} : { effort: expectedEffort }),
      format: { type: "json_schema", schema },
    });
    expect(fixture.seen?.thinking).toEqual(expectedThinking);
  });

  it("sends the Haiku 5.5 economy profile without parameters the model rejects", async () => {
    const selected = selection(
      profile("anthropic", "author", {
        id: "economy-anthropic-author",
        modelId: "claude-haiku-5-5",
        effort: "medium",
        maxOutputTokens: 32768,
        knownMaxOutputTokens: 128000,
      }),
    );
    type Params = Parameters<AnthropicClient["messages"]["create"]>[0];
    let seen: Params | undefined;
    const create = vi.fn((parameters: Params) => {
      seen = parameters;
      return Promise.resolve({
        content: [
          { type: "thinking", thinking: "", signature: "synthetic" },
          { type: "text", text: '{"answer":"yes"}' },
        ],
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 1 },
      }) as ReturnType<AnthropicClient["messages"]["create"]>;
    });
    const adapter = new AnthropicAdapter({ messages: { create } } as unknown as AnthropicClient, {
      configuredModel: selected,
    });

    const response = await adapter.execute(request(selected, 32768));

    expect(response.output).toEqual({ answer: "yes" });
    expect(seen).toMatchObject({ model: "claude-haiku-5-5", max_tokens: 32768 });
    expect(seen?.output_config).toEqual({
      effort: "medium",
      format: { type: "json_schema", schema },
    });
    for (const rejected of ["thinking", "temperature", "top_p", "top_k"]) {
      expect(seen).not.toHaveProperty(rejected);
    }
    expect(seen?.messages).toEqual([{ role: "user", content: expect.any(String) }]);
  });

  it("sends OpenAI reasoning effort and profile output ceiling", async () => {
    const selectedProfile = profile("openai", "critic", {
      effort: "high",
      maxOutputTokens: 2048,
    });
    const selected = selection(selectedProfile);
    const fixture = openAIFixture();
    const adapter = new OpenAIAdapter(fixture.client, { configuredModel: selected });

    await adapter.execute(request(selected));

    expect(fixture.seen).toMatchObject({
      model: selected.modelId,
      max_output_tokens: 2048,
      reasoning: { effort: "high" },
      store: false,
      text: { format: { type: "json_schema", name: "answer_schema", schema, strict: true } },
    });
  });

  it("omits OpenAI reasoning overrides for provider-default effort", async () => {
    const selected = selection(profile("openai", "critic"));
    const fixture = openAIFixture();
    const adapter = new OpenAIAdapter(fixture.client, { configuredModel: selected });

    await adapter.execute(request(selected));

    expect(fixture.seen).not.toHaveProperty("reasoning");
  });

  it.each([{ mode: "disabled" as const }, { mode: "budgeted" as const, maxTokens: 1024 }])(
    "rejects OpenAI $mode thinking before the client call",
    async (thinking) => {
      const selected = selection(profile("openai", "critic", { thinking }));
      const fixture = openAIFixture();
      const adapter = new OpenAIAdapter(fixture.client, { configuredModel: selected });

      const error = await capturedError(() => adapter.execute(request(selected)));

      expect(error).toMatchObject({
        provider: "openai",
        code: "invalid-request",
        retryable: false,
        message: "The selected model profile is invalid for this provider request.",
      });
      expect(fixture.create).not.toHaveBeenCalled();
    },
  );

  it.each([
    { maxOutputTokens: 2048, thinking: { mode: "budgeted" as const, maxTokens: 1000 } },
    { maxOutputTokens: 4096, thinking: { mode: "budgeted" as const, maxTokens: 4096 } },
  ])("rejects Anthropic thinking budgets outside SDK bounds", async (controls) => {
    const selected = selection(profile("anthropic", "author", controls));
    const fixture = anthropicFixture();
    const adapter = new AnthropicAdapter(fixture.client, { configuredModel: selected });

    const error = await capturedError(() => adapter.execute(request(selected)));

    expect(error).toMatchObject({ code: "invalid-request", retryable: false });
    expect(fixture.create).not.toHaveBeenCalled();
  });

  it("rejects a conflicting explicit output budget", async () => {
    const selected = selection(profile("anthropic", "author", { maxOutputTokens: 4096 }));
    const fixture = anthropicFixture();
    const adapter = new AnthropicAdapter(fixture.client, { configuredModel: selected });

    const error = await capturedError(() => adapter.execute(request(selected, 2048)));

    expect(error).toMatchObject({ code: "invalid-request", retryable: false });
    expect(fixture.create).not.toHaveBeenCalled();
  });

  it("keeps the adapter output safety ceiling for otherwise valid profiles", async () => {
    const selected = selection(
      profile("anthropic", "author", {
        maxOutputTokens: 32769,
        knownMaxOutputTokens: 65536,
      }),
    );
    const fixture = anthropicFixture();
    const adapter = new AnthropicAdapter(fixture.client, { configuredModel: selected });

    const error = await capturedError(() => adapter.execute(request(selected)));

    expect(error).toMatchObject({ code: "invalid-request", retryable: false });
    expect(fixture.create).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "requires matching full profiles",
      configuredProfile: profile("anthropic", "author", { effort: "low" }),
      requestedProfile: profile("anthropic", "author", { effort: "high" }),
      configuredRole: "author" as const,
      requestedRole: "author" as const,
      configuredModelId: "anthropic-test-model",
      requestedModelId: "anthropic-test-model",
    },
    {
      name: "validates profile model identity",
      configuredProfile: profile("anthropic", "author"),
      requestedProfile: profile("anthropic", "author"),
      configuredRole: "author" as const,
      requestedRole: "author" as const,
      configuredModelId: "other-model",
      requestedModelId: "other-model",
    },
    {
      name: "validates selected role",
      configuredProfile: profile("anthropic", "author", { roles: ["author"] }),
      requestedProfile: profile("anthropic", "author", { roles: ["author"] }),
      configuredRole: "critic" as const,
      requestedRole: "critic" as const,
      configuredModelId: "anthropic-test-model",
      requestedModelId: "anthropic-test-model",
    },
  ])(
    "rejects profile mismatch before SDK call: $name",
    async ({
      configuredProfile,
      requestedProfile,
      configuredRole,
      requestedRole,
      configuredModelId,
      requestedModelId,
    }) => {
      const configured = selection(configuredProfile, configuredRole, configuredModelId);
      const requested = selection(requestedProfile, requestedRole, requestedModelId);
      const fixture = anthropicFixture();
      const adapter = new AnthropicAdapter(fixture.client, { configuredModel: configured });

      const error = await capturedError(() => adapter.execute(request(requested)));

      expect(error).toBeInstanceOf(ProviderAdapterError);
      expect(error).toMatchObject({ code: "invalid-request", retryable: false });
      expect(fixture.create).not.toHaveBeenCalled();
    },
  );

  it("rejects one-sided or malformed profile snapshots before the SDK call", async () => {
    const validProfile = profile("anthropic", "author");
    const configured = selection(validProfile);
    const fixture = anthropicFixture();
    const adapter = new AnthropicAdapter(fixture.client, { configuredModel: configured });

    const oneSidedError = await capturedError(() =>
      adapter.execute(
        request({
          company: configured.company,
          modelId: configured.modelId,
          role: configured.role,
          promptTemplateVersion: configured.promptTemplateVersion,
        }),
      ),
    );
    expect(oneSidedError).toMatchObject({ code: "invalid-request", retryable: false });

    const malformedProfile = {
      ...validProfile,
      runtime: { ...validProfile.runtime, unsafe: "secret-control" },
    } as ModelProfile;
    const malformed = selection(malformedProfile);
    const malformedError = await capturedError(() => adapter.execute(request(malformed)));
    expect(malformedError).toMatchObject({
      code: "invalid-request",
      retryable: false,
      message: "The selected model profile is invalid for this provider request.",
    });
    expect((malformedError as Error).message).not.toContain("secret-control");

    const legacySelection: ModelSelection = {
      company: "anthropic",
      modelId: validProfile.modelId,
      role: "author",
      promptTemplateVersion: "author-v1",
    };
    const inverseFixture = anthropicFixture();
    const inverseAdapter = new AnthropicAdapter(inverseFixture.client, {
      configuredModel: legacySelection,
    });
    const inverseError = await capturedError(() => inverseAdapter.execute(request(configured)));
    expect(inverseError).toMatchObject({ code: "invalid-request", retryable: false });
    expect(inverseFixture.create).not.toHaveBeenCalled();
    expect(fixture.create).not.toHaveBeenCalled();
  });
});
