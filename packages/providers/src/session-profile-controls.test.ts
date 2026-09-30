import type { AgentRole, ModelSelection } from "@draft-loop/domain";
import type {
  ModelProfile,
  ModelProfileEffort,
  ModelProfileThinking,
} from "@draft-loop/domain/model-profile";
import { describe, expect, it, vi } from "vitest";
import {
  AnthropicClaudeUserSessionAdapter,
  LocalModelAdapter,
  type ModelRequest,
  OpenAICodexUserSessionAdapter,
  type UserSessionProcessRunner,
} from "./index.js";

const policy = {
  allowTransmission: true,
  allowedCompanies: ["anthropic", "openai", "local"],
  sensitiveData: false,
  sensitiveDataAcknowledged: false,
} as const;

const outputSchema = {
  type: "object",
  properties: { answer: { type: "string" } },
  required: ["answer"],
  additionalProperties: false,
} as const;

function modelProfile(
  options: {
    readonly provider?: "anthropic" | "openai" | "local";
    readonly role?: AgentRole;
    readonly id?: string;
    readonly modelId?: string;
    readonly roles?: readonly AgentRole[];
    readonly effort?: ModelProfileEffort;
    readonly thinking?: ModelProfileThinking;
    readonly maxOutputTokens?: number;
    readonly knownMaxOutputTokens?: number;
  } = {},
): ModelProfile {
  const provider = options.provider ?? "anthropic";
  const role = options.role ?? "author";
  const maxOutputTokens = options.maxOutputTokens ?? 2048;
  return {
    id: options.id ?? `${provider}-${role}-snapshot`,
    version: 1,
    provider,
    modelId: options.modelId ?? "claude-test-model",
    tier: "standard",
    roles: options.roles ?? [role],
    runtime: {
      effort: options.effort ?? "provider-default",
      maxOutputTokens,
      thinking: options.thinking ?? { mode: "provider-default" },
    },
    knownLimits: {
      maxOutputTokens: options.knownMaxOutputTokens ?? 65_536,
      contextWindowTokens: 200_000,
    },
  };
}

function selection(
  profile: ModelProfile,
  overrides: Partial<Omit<ModelSelection, "profile">> = {},
): ModelSelection {
  const role = overrides.role ?? profile.roles[0] ?? "author";
  return {
    company: profile.provider,
    modelId: profile.modelId,
    role,
    promptTemplateVersion: `${role}-v1`,
    ...overrides,
    profile,
  };
}

function request(
  model: ModelSelection,
  overrides: Partial<ModelRequest> = {},
  includeOutputBudget = true,
): ModelRequest {
  return {
    contextSnapshotId: "snapshot-session-profile",
    model,
    systemPrompt: "Return JSON only.",
    input: { question: "answer?" },
    outputSchema,
    outputName: "answer_schema",
    ...(includeOutputBudget ? { maxOutputTokens: 20 } : {}),
    dataPolicy: policy,
    ...overrides,
  };
}

function requestWithoutOutputBudget(model: ModelSelection): ModelRequest {
  return request(model, {}, false);
}

function successfulResult() {
  return {
    exitCode: 0,
    stdout: JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      session_id: "profile-session",
      structured_output: { answer: "yes" },
      usage: { input_tokens: 4, output_tokens: 3 },
    }),
    stderr: "",
  };
}

function expectControlEnvironmentAbsent(environment: Readonly<Record<string, string | undefined>>) {
  const names = [
    "CLAUDE_CODE_EFFORT_LEVEL",
    "MAX_THINKING_TOKENS",
    "CLAUDE_CODE_DISABLE_THINKING",
    "CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING",
  ];
  const normalized = new Set(names.map((name) => name.toLowerCase()));
  expect(Object.keys(environment).filter((name) => normalized.has(name.toLowerCase()))).toEqual([]);
}

describe("Claude user-session profile controls", () => {
  it("omits provider-default overrides and strips inherited controls only for profiles", async () => {
    const profile = modelProfile({
      modelId: "claude-sonnet-4-5",
      maxOutputTokens: 2048,
      thinking: { mode: "provider-default" },
    });
    const configured = selection(profile);
    let captured:
      | { args: readonly string[]; env: Readonly<Record<string, string | undefined>> }
      | undefined;
    const runner = vi.fn<UserSessionProcessRunner>(async (_command, args, options) => {
      captured = { args: [...args], env: { ...options.env } };
      return successfulResult();
    });
    const adapter = new AnthropicClaudeUserSessionAdapter({
      configuredModel: configured,
      runner,
      environment: {
        HOME: "/session-home",
        CLAUDE_CODE_EFFORT_LEVEL: "high",
        MAX_THINKING_TOKENS: "4096",
        CLAUDE_CODE_DISABLE_THINKING: "1",
        CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING: "1",
      },
    });

    await adapter.execute(request(configured, { maxOutputTokens: 2048 }));

    expect(captured?.args).not.toContain("--effort");
    expect(captured?.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS).toBe("2048");
    expectControlEnvironmentAbsent(captured?.env ?? {});

    const legacyRunner = vi.fn<UserSessionProcessRunner>(async (_command, _args, options) => {
      captured = { args: [], env: { ...options.env } };
      return successfulResult();
    });
    const legacyAdapter = new AnthropicClaudeUserSessionAdapter({
      configuredModel: {
        company: "anthropic",
        modelId: "claude-test-model",
        role: "author",
        promptTemplateVersion: "author-v1",
      },
      runner: legacyRunner,
      environment: {
        CLAUDE_CODE_EFFORT_LEVEL: "high",
        CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING: "1",
      },
    });
    await legacyAdapter.execute(
      request({
        company: "anthropic",
        modelId: "claude-test-model",
        role: "author",
        promptTemplateVersion: "author-v1",
      }),
    );
    expect(captured?.env.CLAUDE_CODE_EFFORT_LEVEL).toBe("high");
    expect(captured?.env.CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING).toBe("1");
  });

  it.each([
    {
      modelId: "claude-sonnet-4-5",
      name: "the exact budgeted allowance on the alias",
      thinking: { mode: "budgeted", maxTokens: 1536 } as const,
      expected: "1536",
    },
    {
      modelId: "claude-sonnet-4-5-20250929",
      name: "disabled thinking without the disable flag on the pinned snapshot",
      thinking: { mode: "disabled" } as const,
      expected: "0",
    },
  ])("sets $name", async ({ modelId, thinking, expected }) => {
    const profile = modelProfile({
      modelId,
      maxOutputTokens: 4096,
      thinking,
    });
    const configured = selection(profile);
    let environment: Readonly<Record<string, string | undefined>> | undefined;
    const runner = vi.fn<UserSessionProcessRunner>(async (_command, _args, options) => {
      environment = { ...options.env };
      return successfulResult();
    });
    const adapter = new AnthropicClaudeUserSessionAdapter({ configuredModel: configured, runner });

    await adapter.execute(request(configured, { maxOutputTokens: 4096 }));

    expect(environment?.MAX_THINKING_TOKENS).toBe(expected);
    expect(environment).not.toHaveProperty("CLAUDE_CODE_DISABLE_THINKING");
    expect(environment).not.toHaveProperty("CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING");
  });

  it("uses profile effort for other CLI models and the snapshotted output ceiling", async () => {
    const profile = modelProfile({
      modelId: "claude-other-model",
      effort: "high",
      maxOutputTokens: 3072,
    });
    const configured = selection(profile);
    let captured:
      | { args: readonly string[]; env: Readonly<Record<string, string | undefined>> }
      | undefined;
    const runner = vi.fn<UserSessionProcessRunner>(async (_command, args, options) => {
      captured = { args: [...args], env: { ...options.env } };
      return successfulResult();
    });
    const adapter = new AnthropicClaudeUserSessionAdapter({
      configuredModel: configured,
      runner,
      environment: { CLAUDE_CODE_EFFORT_LEVEL: "low" },
    });

    await adapter.execute(requestWithoutOutputBudget(configured));

    const modelIndex = captured?.args.indexOf("--model") ?? -1;
    expect(captured?.args.slice(modelIndex, modelIndex + 4)).toEqual([
      "--model",
      "claude-other-model",
      "--effort",
      "high",
    ]);
    expect(captured?.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS).toBe("3072");
    expect(captured?.env.MAX_THINKING_TOKENS).toBeUndefined();
    expect(captured?.env.CLAUDE_CODE_EFFORT_LEVEL).toBeUndefined();
  });

  it.each([
    { profileEffort: "low" as const, constructorEffort: "high" as const },
    { profileEffort: "provider-default" as const, constructorEffort: "high" as const },
  ])(
    "rejects conflicting constructor effort before launching",
    async ({ profileEffort, constructorEffort }) => {
      const configured = selection(modelProfile({ effort: profileEffort }));
      const runner = vi.fn<UserSessionProcessRunner>();
      const adapter = new AnthropicClaudeUserSessionAdapter({
        configuredModel: configured,
        runner,
        effort: constructorEffort,
      });

      await expect(
        adapter.execute(request(configured, { maxOutputTokens: 2048 })),
      ).rejects.toMatchObject({
        code: "invalid-request",
        retryable: false,
        message: "The selected model profile is invalid for this provider request.",
      });
      expect(runner).not.toHaveBeenCalled();
    },
  );

  it("accepts a constructor effort that exactly matches the profile", async () => {
    const configured = selection(modelProfile({ modelId: "claude-other-model", effort: "low" }));
    let args: readonly string[] = [];
    const runner = vi.fn<UserSessionProcessRunner>(async (_command, receivedArgs) => {
      args = [...receivedArgs];
      return successfulResult();
    });
    const adapter = new AnthropicClaudeUserSessionAdapter({
      configuredModel: configured,
      runner,
      effort: "low",
    });

    await adapter.execute(request(configured, { maxOutputTokens: 2048 }));

    expect(args.slice(args.indexOf("--model"), args.indexOf("--model") + 4)).toEqual([
      "--model",
      "claude-other-model",
      "--effort",
      "low",
    ]);
  });

  it.each([
    { modelId: "claude-unknown-model", thinking: { mode: "budgeted", maxTokens: 1024 } as const },
    { modelId: "claude-unknown-model", thinking: { mode: "disabled" } as const },
    {
      modelId: "claude-sonnet-4-5",
      thinking: { mode: "budgeted", maxTokens: 1024 } as const,
      effort: "low" as const,
    },
  ])(
    "rejects unsupported Claude profile controls before launch",
    async ({ modelId, thinking, effort }) => {
      const configured = selection(
        modelProfile({ modelId, thinking, ...(effort ? { effort } : {}) }),
      );
      const runner = vi.fn<UserSessionProcessRunner>();
      const adapter = new AnthropicClaudeUserSessionAdapter({
        configuredModel: configured,
        runner,
      });

      await expect(
        adapter.execute(request(configured, { maxOutputTokens: 2048 })),
      ).rejects.toMatchObject({ code: "invalid-request", retryable: false });
      expect(runner).not.toHaveBeenCalled();
    },
  );

  it("rejects invalid budgets, conflicting request output, and mismatched full snapshots", async () => {
    const valid = modelProfile({ modelId: "claude-other-model" });
    const configured = selection(valid);
    const runner = vi.fn<UserSessionProcessRunner>();
    const adapter = new AnthropicClaudeUserSessionAdapter({ configuredModel: configured, runner });

    const invalidBudget = selection(
      modelProfile({
        id: valid.id,
        modelId: valid.modelId,
        maxOutputTokens: 2048,
        thinking: { mode: "budgeted", maxTokens: 2048 },
      }),
    );
    const mismatchedFullSnapshot = selection({
      ...valid,
      runtime: { ...valid.runtime, effort: "low" },
    });

    await expect(
      adapter.execute(request(invalidBudget, { maxOutputTokens: 2048 })),
    ).rejects.toMatchObject({ code: "invalid-request", retryable: false });
    await expect(
      adapter.execute(request(configured, { maxOutputTokens: 1024 })),
    ).rejects.toMatchObject({ code: "invalid-request", retryable: false });
    await expect(
      adapter.execute(request(mismatchedFullSnapshot, { maxOutputTokens: 2048 })),
    ).rejects.toMatchObject({ code: "invalid-request", retryable: false });
    expect(runner).not.toHaveBeenCalled();
  });

  it("keeps the existing session output ceiling for profiles", async () => {
    const configured = selection(
      modelProfile({ maxOutputTokens: 32_769, knownMaxOutputTokens: 65_536 }),
    );
    const runner = vi.fn<UserSessionProcessRunner>();
    const adapter = new AnthropicClaudeUserSessionAdapter({ configuredModel: configured, runner });

    await expect(adapter.execute(requestWithoutOutputBudget(configured))).rejects.toMatchObject({
      code: "invalid-request",
      retryable: false,
      diagnostics: [{ code: "invalid_output_token_budget", path: "maxOutputTokens" }],
    });
    expect(runner).not.toHaveBeenCalled();
  });

  it("rejects a selection role missing from its profile before launch", async () => {
    const invalidSelection = selection(modelProfile(), { role: "critic" });
    const runner = vi.fn<UserSessionProcessRunner>();
    const adapter = new AnthropicClaudeUserSessionAdapter({
      configuredModel: invalidSelection,
      runner,
    });

    await expect(
      adapter.execute(request(invalidSelection, { maxOutputTokens: 2048 })),
    ).rejects.toMatchObject({ code: "invalid-request", retryable: false });
    expect(runner).not.toHaveBeenCalled();
  });
});

describe("session runtimes that do not support profiles", () => {
  it.each(["configured", "requested"] as const)(
    "rejects a profile on the %s Codex selection before tempdir or runner work",
    async (profiledSide) => {
      const base: ModelSelection = {
        company: "openai",
        modelId: "gpt-test-model",
        role: "critic",
        promptTemplateVersion: "critic-v1",
      };
      const withProfile = selection(
        modelProfile({
          provider: "openai",
          role: "critic",
          modelId: base.modelId,
        }),
      );
      const configuredModel = profiledSide === "configured" ? withProfile : base;
      const requestModel = profiledSide === "requested" ? withProfile : base;
      const runner = vi.fn<UserSessionProcessRunner>();
      const adapter = new OpenAICodexUserSessionAdapter({ configuredModel, runner });

      await expect(adapter.execute(request(requestModel))).rejects.toMatchObject({
        provider: "openai",
        code: "invalid-request",
        retryable: false,
        diagnostics: [{ code: "profile_generation_cap", path: "model.profile" }],
      });
      expect(runner).not.toHaveBeenCalled();
    },
  );

  it.each(["configured", "requested"] as const)(
    "rejects a profile on the %s local selection before invoking its client",
    async (profiledSide) => {
      const base: ModelSelection = {
        company: "local",
        modelId: "local-test-model",
        role: "author",
        promptTemplateVersion: "author-v1",
      };
      const withProfile = selection(
        modelProfile({ provider: "local", modelId: "local-test-model" }),
      );
      const configured = profiledSide === "configured" ? withProfile : base;
      const requested = profiledSide === "requested" ? withProfile : base;
      const fetch = vi.fn<typeof globalThis.fetch>();
      const adapter = new LocalModelAdapter({ fetch }, { configuredModel: configured });

      await expect(adapter.execute(request(requested))).rejects.toMatchObject({
        provider: "local",
        code: "invalid-request",
        retryable: false,
        diagnostics: [{ code: "profile_runtime_unsupported", path: "model.profile" }],
      });
      expect(fetch).not.toHaveBeenCalled();
    },
  );
});
