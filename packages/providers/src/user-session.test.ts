import { stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { ModelSelection } from "@draft-loop/domain";
import { describe, expect, it, vi } from "vitest";

import {
  AnthropicClaudeUserSessionAdapter,
  type ModelRequest,
  OpenAICodexUserSessionAdapter,
  ProviderAdapterError,
  probeAnthropicClaudeUserSession,
  probeOpenAICodexUserSession,
  UserSessionProcessError,
  type UserSessionProcessRunner,
} from "./index.js";

const anthropicModel: ModelSelection = {
  company: "anthropic",
  modelId: "claude-exact",
  role: "author",
  promptTemplateVersion: "author-v1",
};
const openAIModel: ModelSelection = {
  company: "openai",
  modelId: "gpt-exact",
  role: "critic",
  promptTemplateVersion: "critic-v1",
};
const outputSchema = {
  type: "object",
  properties: { answer: { type: "string" } },
  required: ["answer"],
  additionalProperties: false,
} as const;
const policy = {
  allowTransmission: true,
  allowedCompanies: ["anthropic", "openai"],
  sensitiveData: false,
  sensitiveDataAcknowledged: false,
} as const;

function request(model: ModelSelection, overrides: Partial<ModelRequest> = {}): ModelRequest {
  return {
    contextSnapshotId: "snapshot-user-session",
    model,
    systemPrompt: "Return JSON only.",
    input: { question: "answer?" },
    outputSchema,
    outputName: "answer_schema",
    maxOutputTokens: 20,
    dataPolicy: policy,
    ...overrides,
  };
}

describe("AnthropicClaudeUserSessionAdapter", () => {
  it("uses the locked-down Claude argv, private cwd, scrubbed environment, and structured result", async () => {
    const runner = vi.fn<UserSessionProcessRunner>(async (command, args, options) => {
      expect(command).toBe("claude-test");
      expect(args).toEqual([
        "-p",
        "--safe-mode",
        "--tools",
        "",
        "--disallowedTools",
        "mcp__*",
        "--strict-mcp-config",
        "--mcp-config",
        '{"mcpServers":{}}',
        "--disable-slash-commands",
        "--no-chrome",
        "--no-session-persistence",
        "--permission-mode",
        "dontAsk",
        "--model",
        "claude-exact",
        "--system-prompt",
        "Return JSON only.",
        "--output-format",
        "json",
        "--json-schema",
        JSON.stringify(outputSchema),
      ]);
      expect(options.stdin).toBe('{"question":"answer?"}');
      expect(options.env).toMatchObject({ HOME: "/login-store", KEEP: "yes" });
      expect(options.env.ANTHROPIC_API_KEY).toBeUndefined();
      expect(options.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS).toBe("20");
      expect(options.env.CLAUDE_CODE_MAX_RETRIES).toBe("0");
      expect(options.env.MAX_STRUCTURED_OUTPUT_RETRIES).toBe("0");
      expect(options.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
      expect(options.env.ANTHROPIC_BASE_URL).toBeUndefined();
      expect((await stat(options.cwd)).mode & 0o777).toBe(0o700);
      expect(await import("node:fs/promises").then((fs) => fs.readdir(options.cwd))).toEqual([]);
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          type: "result",
          subtype: "success",
          is_error: false,
          session_id: "claude-session",
          structured_output: { answer: "yes" },
          usage: { input_tokens: 9, output_tokens: 4 },
          permission_denials: [],
        }),
        stderr: "",
      };
    });
    const adapter = new AnthropicClaudeUserSessionAdapter({
      configuredModel: anthropicModel,
      command: "claude-test",
      runner,
      environment: {
        HOME: "/login-store",
        KEEP: "yes",
        ANTHROPIC_API_KEY: "secret",
        ANTHROPIC_AUTH_TOKEN: "secret",
        ANTHROPIC_BASE_URL: "https://override.invalid",
      },
    });

    await expect(adapter.execute(request(anthropicModel))).resolves.toMatchObject({
      output: { answer: "yes" },
      provider: "anthropic",
      company: "anthropic",
      modelId: "claude-exact",
      providerRequestId: "claude-session",
      usage: { inputTokens: 9, outputTokens: 4, totalTokens: 13 },
      cost: { estimatedUsd: null },
    });
  });

  it("rejects reported tool use", async () => {
    const runner: UserSessionProcessRunner = async () => ({
      exitCode: 0,
      stdout: JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: false,
        session_id: "session",
        structured_output: { answer: "no" },
        usage: { input_tokens: 1, output_tokens: 1 },
        tool_use: { name: "bad" },
      }),
      stderr: "",
    });
    const adapter = new AnthropicClaudeUserSessionAdapter({
      configuredModel: anthropicModel,
      runner,
    });

    await expect(adapter.execute(request(anthropicModel))).rejects.toMatchObject({
      code: "invalid-response",
      diagnostics: [{ code: "tool_use_reported", path: "stdout" }],
    });
  });

  it("maps a successful-process Claude weekly-limit envelope to quota exhaustion", async () => {
    const adapter = new AnthropicClaudeUserSessionAdapter({
      configuredModel: anthropicModel,
      runner: async () => ({
        exitCode: 0,
        stdout: JSON.stringify({
          type: "result",
          subtype: "error",
          is_error: true,
          api_error_status: 429,
          result: "Sensitive weekly limit detail",
        }),
        stderr: "must not leak",
      }),
    });

    try {
      await adapter.execute(request(anthropicModel));
      throw new Error("expected rejection");
    } catch (error) {
      expect(error).toMatchObject({ code: "quota-exhausted", retryable: false });
      expect((error as Error).message).not.toContain("Sensitive");
    }
  });
});

describe("OpenAICodexUserSessionAdapter", () => {
  it("uses locked-down Codex argv/config, private files, scrubbed environment, and JSONL usage", async () => {
    const runner = vi.fn<UserSessionProcessRunner>(async (command, args, options) => {
      expect(command).toBe("codex-test");
      const schemaIndex = args.indexOf("--output-schema");
      const outputIndex = args.indexOf("--output-last-message");
      const schemaPath = args[schemaIndex + 1];
      const outputPath = args[outputIndex + 1];
      expect(schemaPath).toBeDefined();
      expect(outputPath).toBeDefined();
      if (schemaPath === undefined || outputPath === undefined) throw new Error("paths missing");
      expect(dirname(schemaPath)).toBe(options.cwd);
      expect(dirname(outputPath)).toBe(options.cwd);
      expect((await stat(options.cwd)).mode & 0o777).toBe(0o700);
      expect((await stat(schemaPath)).mode & 0o777).toBe(0o600);
      expect((await stat(outputPath)).mode & 0o777).toBe(0o600);
      expect(options.env).toMatchObject({ HOME: "/login-store", KEEP: "yes" });
      expect(options.env.OPENAI_API_KEY).toBeUndefined();
      expect(options.env.CODEX_API_KEY).toBeUndefined();
      expect(options.env.OPENAI_BASE_URL).toBeUndefined();
      expect(options.stdin).toBe(
        'System instructions:\nReturn JSON only.\n\nInput JSON:\n{"question":"answer?"}',
      );
      expect(args).toEqual([
        "exec",
        "-",
        "--json",
        "--output-schema",
        schemaPath,
        "--output-last-message",
        outputPath,
        "--ephemeral",
        "--ignore-user-config",
        "--ignore-rules",
        "--skip-git-repo-check",
        "--cd",
        options.cwd,
        "--model",
        "gpt-exact",
        "--sandbox",
        "read-only",
        "--strict-config",
        "--config",
        'model_reasoning_effort="low"',
        "--config",
        'approval_policy="never"',
        "--config",
        "features.shell_tool=false",
        "--config",
        "features.unified_exec=false",
        "--config",
        "features.multi_agent=false",
        "--config",
        "features.apps=false",
        "--config",
        "features.browser_use=false",
        "--config",
        "features.computer_use=false",
        "--config",
        "features.goals=false",
        "--config",
        "features.hooks=false",
        "--config",
        "features.image_generation=false",
        "--config",
        "apps._default.enabled=false",
        "--config",
        'web_search="disabled"',
      ]);
      await writeFile(outputPath, '{"answer":"yes"}', { mode: 0o600 });
      return {
        exitCode: 0,
        stdout: [
          JSON.stringify({ type: "thread.started", thread_id: "codex-thread" }),
          JSON.stringify({ type: "turn.started" }),
          JSON.stringify({
            type: "item.completed",
            item: { type: "agent_message", text: '{"answer":"yes"}' },
          }),
          JSON.stringify({
            type: "turn.completed",
            usage: { input_tokens: 12, output_tokens: 3 },
          }),
        ].join("\n"),
        stderr: "",
      };
    });
    const adapter = new OpenAICodexUserSessionAdapter({
      configuredModel: openAIModel,
      command: "codex-test",
      runner,
      environment: {
        HOME: "/login-store",
        KEEP: "yes",
        OPENAI_API_KEY: "secret",
        CODEX_API_KEY: "secret",
        OPENAI_BASE_URL: "https://override.invalid",
      },
    });

    await expect(adapter.execute(request(openAIModel))).resolves.toMatchObject({
      output: { answer: "yes" },
      provider: "openai",
      company: "openai",
      modelId: "gpt-exact",
      providerRequestId: "codex-thread",
      usage: { inputTokens: 12, outputTokens: 3, totalTokens: 15 },
      cost: { estimatedUsd: null },
    });
  });

  it("keeps author reasoning at the runtime default", async () => {
    const authorModel = { ...openAIModel, role: "author" as const };
    const runner = vi.fn<UserSessionProcessRunner>(async (_command, args) => {
      expect(args).not.toContain('model_reasoning_effort="low"');
      const outputPath = args[args.indexOf("--output-last-message") + 1];
      if (outputPath === undefined) throw new Error("output path missing");
      await writeFile(outputPath, '{"answer":"yes"}');
      return {
        exitCode: 0,
        stdout: [
          JSON.stringify({ type: "thread.started", thread_id: "thread" }),
          JSON.stringify({
            type: "turn.completed",
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
        ].join("\n"),
        stderr: "",
      };
    });
    const adapter = new OpenAICodexUserSessionAdapter({
      configuredModel: authorModel,
      runner,
    });

    await expect(adapter.execute(request(authorModel))).resolves.toMatchObject({
      output: { answer: "yes" },
    });
  });

  it("rejects prohibited command events before reading a valid final response", async () => {
    const runner: UserSessionProcessRunner = async (_command, args) => {
      const outputPath = args[args.indexOf("--output-last-message") + 1];
      if (outputPath === undefined) throw new Error("output path missing");
      await writeFile(outputPath, '{"answer":"unsafe"}');
      return {
        exitCode: 0,
        stdout: [
          JSON.stringify({ type: "thread.started", thread_id: "thread" }),
          JSON.stringify({
            type: "item.completed",
            item: { type: "command_execution", command: "pwd" },
          }),
          JSON.stringify({
            type: "turn.completed",
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
        ].join("\n"),
        stderr: "",
      };
    };
    const adapter = new OpenAICodexUserSessionAdapter({ configuredModel: openAIModel, runner });

    await expect(adapter.execute(request(openAIModel))).rejects.toMatchObject({
      code: "invalid-response",
      diagnostics: [{ code: "prohibited_item" }],
    });
  });

  it("rejects malformed JSONL and post-generation output-token excess", async () => {
    const malformed = new OpenAICodexUserSessionAdapter({
      configuredModel: openAIModel,
      runner: async () => ({ exitCode: 0, stdout: "not-json", stderr: "" }),
    });
    await expect(malformed.execute(request(openAIModel))).rejects.toMatchObject({
      code: "invalid-response",
    });

    const excessive = new OpenAICodexUserSessionAdapter({
      configuredModel: openAIModel,
      runner: async (_command, args) => {
        const outputPath = args[args.indexOf("--output-last-message") + 1];
        if (outputPath === undefined) throw new Error("output path missing");
        await writeFile(outputPath, '{"answer":"large"}');
        return {
          exitCode: 0,
          stdout: [
            JSON.stringify({ type: "thread.started", thread_id: "thread" }),
            JSON.stringify({
              type: "turn.completed",
              usage: { input_tokens: 1, output_tokens: 21 },
            }),
          ].join("\n"),
          stderr: "",
        };
      },
    });
    await expect(excessive.execute(request(openAIModel))).rejects.toMatchObject({
      code: "invalid-response",
      diagnostics: [{ code: "output_token_budget_exceeded" }],
    });
  });
});

describe("user-session error normalization and login probes", () => {
  it("maps cancellation, auth, and quota without exposing raw stderr", async () => {
    const cancelled = new AnthropicClaudeUserSessionAdapter({
      configuredModel: anthropicModel,
      runner: async () => {
        throw new UserSessionProcessError("cancelled");
      },
    });
    await expect(cancelled.execute(request(anthropicModel))).rejects.toMatchObject({
      code: "cancelled",
      retryable: false,
    });

    for (const [stderr, code] of [
      ["secret detail: login required", "authentication"],
      ["secret detail: insufficient_quota", "quota-exhausted"],
      ['{"api_error_status":429,"result":"weekly limit"}', "quota-exhausted"],
    ] as const) {
      const adapter = new OpenAICodexUserSessionAdapter({
        configuredModel: openAIModel,
        runner: async () => ({ exitCode: 1, stdout: "", stderr }),
      });
      try {
        await adapter.execute(request(openAIModel));
        throw new Error("expected rejection");
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderAdapterError);
        expect(error).toMatchObject({ code });
        expect((error as Error).message).not.toContain("secret detail");
      }
    }
  });

  it("returns only availability/authentication booleans from safe probes", async () => {
    const calls: { readonly command: string; readonly args: readonly string[] }[] = [];
    const runner: UserSessionProcessRunner = async (command, args, options) => {
      calls.push({ command, args });
      expect(options.env.OPENAI_API_KEY ?? options.env.ANTHROPIC_API_KEY).toBeUndefined();
      return { exitCode: command === "claude-custom" ? 0 : 1, stdout: "identity", stderr: "token" };
    };
    await expect(
      probeAnthropicClaudeUserSession({
        command: "claude-custom",
        runner,
        environment: { ANTHROPIC_API_KEY: "secret" },
      }),
    ).resolves.toEqual({ available: true, authenticated: true });
    await expect(
      probeOpenAICodexUserSession({
        command: "codex-custom",
        runner,
        environment: { OPENAI_API_KEY: "secret" },
      }),
    ).resolves.toEqual({ available: true, authenticated: false });
    expect(calls).toEqual([
      { command: "claude-custom", args: ["auth", "status", "--json"] },
      { command: "codex-custom", args: ["login", "status"] },
    ]);

    await expect(
      probeOpenAICodexUserSession({
        runner: async () => {
          throw new UserSessionProcessError("missing-runtime");
        },
      }),
    ).resolves.toEqual({ available: false, authenticated: false });
  });
});
