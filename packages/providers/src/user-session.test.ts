import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { ModelSelection } from "@draft-loop/domain";
import { describe, expect, it, vi } from "vitest";

import {
  AnthropicClaudeUserSessionAdapter,
  type ClaudeEffortLevel,
  claudeEffortLevels,
  defaultUserSessionTimeoutMs,
  type ModelRequest,
  maximumUserSessionTimeoutMs,
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
const anthropicSecretEnvironmentNames = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
] as const;
const claudeAuxiliaryTrafficEnvironmentNames = [
  "CLAUDE_CODE_DISABLE_TERMINAL_TITLE",
  "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
] as const;
const openAISecretEnvironmentNames = [
  "OPENAI_API_KEY",
  "CODEX_API_KEY",
  "OPENAI_BASE_URL",
] as const;
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
const claudeErrorDiagnosticCases = [
  { field: "subtype", value: "success", code: "claude_error_subtype_success" },
  {
    field: "subtype",
    value: "error_max_turns",
    code: "claude_error_subtype_error_max_turns",
  },
  {
    field: "subtype",
    value: "error_during_execution",
    code: "claude_error_subtype_error_during_execution",
  },
  {
    field: "subtype",
    value: "error_max_budget_usd",
    code: "claude_error_subtype_error_max_budget_usd",
  },
  {
    field: "subtype",
    value: "error_max_structured_output_retries",
    code: "claude_error_subtype_error_max_structured_output_retries",
  },
  { field: "terminal_reason", value: "completed", code: "claude_terminal_reason_completed" },
  { field: "terminal_reason", value: "api_error", code: "claude_terminal_reason_api_error" },
  { field: "terminal_reason", value: "max_turns", code: "claude_terminal_reason_max_turns" },
  {
    field: "terminal_reason",
    value: "tool_deferred",
    code: "claude_terminal_reason_tool_deferred",
  },
  {
    field: "terminal_reason",
    value: "aborted_streaming",
    code: "claude_terminal_reason_aborted_streaming",
  },
  {
    field: "terminal_reason",
    value: "aborted_tools",
    code: "claude_terminal_reason_aborted_tools",
  },
  {
    field: "terminal_reason",
    value: "hook_stopped",
    code: "claude_terminal_reason_hook_stopped",
  },
  {
    field: "terminal_reason",
    value: "stop_hook_prevented",
    code: "claude_terminal_reason_stop_hook_prevented",
  },
  {
    field: "terminal_reason",
    value: "blocking_limit",
    code: "claude_terminal_reason_blocking_limit",
  },
  {
    field: "terminal_reason",
    value: "rapid_refill_breaker",
    code: "claude_terminal_reason_rapid_refill_breaker",
  },
  {
    field: "terminal_reason",
    value: "prompt_too_long",
    code: "claude_terminal_reason_prompt_too_long",
  },
  { field: "terminal_reason", value: "image_error", code: "claude_terminal_reason_image_error" },
  { field: "terminal_reason", value: "model_error", code: "claude_terminal_reason_model_error" },
  {
    field: "terminal_reason",
    value: "structured_output_retry_exhausted",
    code: "claude_terminal_reason_structured_output_retry_exhausted",
  },
  { field: "stop_reason", value: "end_turn", code: "claude_stop_reason_end_turn" },
  { field: "stop_reason", value: "max_tokens", code: "claude_stop_reason_max_tokens" },
  { field: "stop_reason", value: "stop_sequence", code: "claude_stop_reason_stop_sequence" },
  { field: "stop_reason", value: "tool_use", code: "claude_stop_reason_tool_use" },
  { field: "stop_reason", value: "pause_turn", code: "claude_stop_reason_pause_turn" },
  { field: "stop_reason", value: "refusal", code: "claude_stop_reason_refusal" },
  {
    field: "stop_reason",
    value: "model_context_window_exceeded",
    code: "claude_stop_reason_model_context_window_exceeded",
  },
] as const;
const claudeErrorFieldPrefixes = [
  ["subtype", "claude_error_subtype"],
  ["terminal_reason", "claude_terminal_reason"],
  ["stop_reason", "claude_stop_reason"],
] as const;

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

async function captureClaudeStructuredError(
  fields: Readonly<Record<string, unknown>> = {},
  options: {
    readonly captureParent?: string;
    readonly environment?: Readonly<Record<string, string | undefined>>;
    readonly exitCode?: number | null;
    readonly stderr?: string;
  } = {},
): Promise<ProviderAdapterError> {
  const adapter = new AnthropicClaudeUserSessionAdapter({
    configuredModel: anthropicModel,
    ...(options.captureParent === undefined
      ? {}
      : { localClaudeCategoryCaptureParent: options.captureParent }),
    ...(options.environment === undefined ? {} : { environment: options.environment }),
    runner: async () => ({
      exitCode: options.exitCode ?? 1,
      stdout: JSON.stringify({ type: "result", is_error: true, ...fields }),
      stderr: options.stderr ?? "",
    }),
  });
  try {
    await adapter.execute(request(anthropicModel));
  } catch (error) {
    if (error instanceof ProviderAdapterError) return error;
    throw error;
  }
  throw new Error("Expected the Claude structured error to reject.");
}

function expectEnvironmentWithoutNames(
  environment: Readonly<Record<string, string | undefined>>,
  names: readonly string[],
): void {
  const forbiddenNames = new Set(names.map((name) => name.toLowerCase()));
  expect(Object.keys(environment).filter((name) => forbiddenNames.has(name.toLowerCase()))).toEqual(
    [],
  );
}

describe("AnthropicClaudeUserSessionAdapter", () => {
  it("accepts malformed optional metadata in a locked-down Claude success result", async () => {
    const runner = vi.fn<UserSessionProcessRunner>(async (command, args, options) => {
      expect(command).toBe("claude-test");
      expect(options.timeoutMs).toBe(defaultUserSessionTimeoutMs);
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
        "--prompt-suggestions",
        "false",
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
      expectEnvironmentWithoutNames(options.env, anthropicSecretEnvironmentNames);
      expect(options.env.CLAUDE_CODE_DISABLE_TERMINAL_TITLE).toBe("1");
      expect(options.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC).toBe("1");
      expect(
        Object.keys(options.env)
          .filter((name) =>
            claudeAuxiliaryTrafficEnvironmentNames.some(
              (expected) => expected.toLowerCase() === name.toLowerCase(),
            ),
          )
          .sort(),
      ).toEqual([...claudeAuxiliaryTrafficEnvironmentNames].sort());
      expect(options.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS).toBe("20");
      expect(options.env.MAX_THINKING_TOKENS).toBe("0");
      expect(options.env.CLAUDE_CODE_DISABLE_THINKING).toBe("1");
      expect(options.env.CLAUDE_CODE_MAX_RETRIES).toBe("0");
      expect(options.env.MAX_STRUCTURED_OUTPUT_RETRIES).toBe("0");
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
          num_turns: "not-a-number",
          stop_reason: { unexpected: "future-stop" },
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
        anthropic_api_key: "mixed-case-secret",
        ANTHROPIC_AUTH_TOKEN: "secret",
        Anthropic_Auth_Token: "mixed-case-secret",
        ANTHROPIC_BASE_URL: "https://override.invalid",
        aNtHrOpIc_BaSe_Url: "https://mixed-case-override.invalid",
        CLAUDE_CODE_DISABLE_TERMINAL_TITLE: "0",
        claude_code_disable_terminal_title: "0",
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "0",
        Claude_Code_Disable_Nonessential_Traffic: "0",
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

  it("accepts cumulative Claude usage above the per-generation cap", async () => {
    const runner = vi.fn<UserSessionProcessRunner>(async (_command, _args, options) => {
      expect(options.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS).toBe("20");
      expect(options.env.MAX_THINKING_TOKENS).toBe("0");
      expect(options.env.CLAUDE_CODE_DISABLE_THINKING).toBe("1");
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          type: "result",
          subtype: "success",
          is_error: false,
          session_id: "claude-multi-turn-session",
          structured_output: { answer: "complete" },
          usage: { input_tokens: 17, output_tokens: 21 },
          num_turns: 3,
          stop_reason: "tool_use",
        }),
        stderr: "",
      };
    });
    const adapter = new AnthropicClaudeUserSessionAdapter({
      configuredModel: anthropicModel,
      runner,
    });

    await expect(adapter.execute(request(anthropicModel))).resolves.toMatchObject({
      output: { answer: "complete" },
      providerRequestId: "claude-multi-turn-session",
      usage: { inputTokens: 17, outputTokens: 21, totalTokens: 38 },
    });
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      maxOutputTokens: 2_047,
      ambientMaxThinkingTokens: "8192",
      ambientDisableThinking: "0",
      expectedMaxThinkingTokens: "0",
      expectedDisableThinking: "1",
    },
    {
      maxOutputTokens: 2_048,
      ambientMaxThinkingTokens: "0",
      ambientDisableThinking: "1",
      expectedMaxThinkingTokens: "1024",
      expectedDisableThinking: undefined,
    },
    {
      maxOutputTokens: 8_192,
      ambientMaxThinkingTokens: "1024",
      ambientDisableThinking: "1",
      expectedMaxThinkingTokens: "4096",
      expectedDisableThinking: undefined,
    },
  ])(
    "derives a bounded Claude thinking environment from the output cap",
    async ({
      maxOutputTokens,
      ambientMaxThinkingTokens,
      ambientDisableThinking,
      expectedMaxThinkingTokens,
      expectedDisableThinking,
    }) => {
      const runner = vi.fn<UserSessionProcessRunner>(async (_command, _args, options) => {
        expect(options.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS).toBe(String(maxOutputTokens));
        expect(options.env.MAX_THINKING_TOKENS).toBe(expectedMaxThinkingTokens);
        if (expectedDisableThinking === undefined) {
          expectEnvironmentWithoutNames(options.env, ["CLAUDE_CODE_DISABLE_THINKING"]);
        } else {
          expect(options.env.CLAUDE_CODE_DISABLE_THINKING).toBe(expectedDisableThinking);
        }
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            type: "result",
            subtype: "success",
            is_error: false,
            session_id: "claude-session",
            structured_output: { answer: "yes" },
            usage: { input_tokens: 1, output_tokens: 1 },
            permission_denials: [],
          }),
          stderr: "",
        };
      });
      const adapter = new AnthropicClaudeUserSessionAdapter({
        configuredModel: anthropicModel,
        runner,
        environment: {
          MAX_THINKING_TOKENS: ambientMaxThinkingTokens,
          CLAUDE_CODE_DISABLE_THINKING: ambientDisableThinking,
        },
      });

      await expect(
        adapter.execute(request(anthropicModel, { maxOutputTokens })),
      ).resolves.toMatchObject({ output: { answer: "yes" } });
    },
  );

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

  it.each([
    [
      429,
      "temporary service response",
      "rate-limit",
      true,
      "The user-session provider rate limit was reached.",
    ],
    [
      429,
      "usage limit reached",
      "quota-exhausted",
      false,
      "The user-session provider quota is exhausted.",
    ],
    [
      401,
      "authentication response",
      "authentication",
      false,
      "The user-session provider is not authenticated.",
    ],
    [
      403,
      "permission response",
      "authentication",
      false,
      "The user-session provider is not authenticated.",
    ],
    [
      500,
      "temporary service response",
      "transient",
      true,
      "The user-session provider encountered a transient error.",
    ],
    [
      529,
      "temporary service response",
      "transient",
      true,
      "The user-session provider encountered a transient error.",
    ],
  ] as const)(
    "maps a nonzero structured Claude status %s without exposing envelope content",
    async (status, resultText, code, retryable, message) => {
      const stdoutMarker = `synthetic-stdout-${status}`;
      const resultMarker = `synthetic-result-${status}`;
      const stderrMarker = `synthetic-stderr-${status}`;
      const errorsMarker = `synthetic-errors-${status}`;
      const sessionMarker = `synthetic-session-${status}`;
      const countMarker = `private-count-${status}-424242`;
      const privateDataMarker = `synthetic-private-data-${status}`;
      const error = await captureClaudeStructuredError(
        {
          subtype: "error_max_structured_output_retries",
          api_error_status: status,
          result: `${resultText} ${resultMarker} ${stdoutMarker}`,
          terminal_reason: "model_error",
          stop_reason: "max_tokens",
          errors: [errorsMarker],
          session_id: sessionMarker,
          num_turns: countMarker,
          private_data: privateDataMarker,
        },
        { exitCode: 1, stderr: stderrMarker },
      );

      expect(error).toMatchObject({ code, retryable, status, metadata: { status } });
      expect(error.message).toBe(message);
      expect(error.diagnostics).toEqual([
        {
          code: "claude_error_subtype_error_max_structured_output_retries",
          path: "subtype",
        },
        { code: "claude_terminal_reason_model_error", path: "terminal_reason" },
        { code: "claude_stop_reason_max_tokens", path: "stop_reason" },
      ]);
      for (const marker of [
        stdoutMarker,
        resultMarker,
        stderrMarker,
        errorsMarker,
        sessionMarker,
        countMarker,
        privateDataMarker,
      ]) {
        expect(error.message).not.toContain(marker);
        expect(JSON.stringify(error.metadata)).not.toContain(marker);
        expect(JSON.stringify(error.diagnostics)).not.toContain(marker);
        expect(JSON.stringify(error)).not.toContain(marker);
      }
    },
  );

  it("maps statusless documented error fields to fixed diagnostics without retaining content", async () => {
    const resultMarker = "private-result-prose-marker";
    const errorsMarker = "private-errors-array-marker";
    const stderrMarker = "private-stderr-marker";
    const sessionMarker = "private-session-marker";
    const error = await captureClaudeStructuredError(
      {
        subtype: "error_max_turns",
        terminal_reason: "prompt_too_long",
        stop_reason: "tool_use",
        result: resultMarker,
        errors: [errorsMarker],
        session_id: sessionMarker,
      },
      { exitCode: 0, stderr: stderrMarker },
    );

    expect(error).toMatchObject({
      code: "unknown",
      retryable: false,
      status: null,
    });
    expect(error.message).toBe("The user-session provider request failed.");
    expect(error.diagnostics).toEqual([
      { code: "claude_error_subtype_error_max_turns", path: "subtype" },
      { code: "claude_terminal_reason_prompt_too_long", path: "terminal_reason" },
      { code: "claude_stop_reason_tool_use", path: "stop_reason" },
    ]);
    for (const marker of [resultMarker, errorsMarker, stderrMarker, sessionMarker]) {
      expect(error.message).not.toContain(marker);
      expect(JSON.stringify(error.metadata)).not.toContain(marker);
      expect(JSON.stringify(error.diagnostics)).not.toContain(marker);
      expect(JSON.stringify(error)).not.toContain(marker);
    }
  });

  it.each([0, 1] as const)(
    "maps statusless api_error results on Claude process exit %i to a retryable transient error",
    async (exitCode) => {
      const captureParent = await mkdtemp(join(tmpdir(), "draft-loop-claude-api-error-test-"));
      const resultMarker = `private-api-error-result-${exitCode}`;
      const errorsMarker = `private-api-error-errors-${exitCode}`;
      const sessionMarker = `private-api-error-session-${exitCode}`;
      const stderrMarker = `private-api-error-stderr-${exitCode}`;
      try {
        const error = await captureClaudeStructuredError(
          {
            subtype: "success",
            terminal_reason: "api_error",
            result: resultMarker,
            errors: [errorsMarker],
            session_id: sessionMarker,
          },
          { captureParent, exitCode, stderr: stderrMarker },
        );

        expect(error).toMatchObject({ code: "transient", retryable: true, status: null });
        expect(error.message).toBe("The user-session provider encountered a transient error.");
        expect(error.diagnostics).toEqual([
          { code: "claude_error_subtype_success", path: "subtype" },
          { code: "claude_terminal_reason_api_error", path: "terminal_reason" },
          { code: "claude_stop_reason_unavailable", path: "stop_reason" },
        ]);
        expect(await readdir(captureParent)).toEqual([]);
        expect(error.diagnostics).not.toContainEqual(
          expect.objectContaining({
            code: expect.stringMatching(/^local_claude_category_capture_/u),
          }),
        );
        for (const marker of [resultMarker, errorsMarker, sessionMarker, stderrMarker]) {
          expect(error.message).not.toContain(marker);
          expect(JSON.stringify(error.metadata)).not.toContain(marker);
          expect(JSON.stringify(error.diagnostics)).not.toContain(marker);
          expect(JSON.stringify(error)).not.toContain(marker);
        }
      } finally {
        await rm(captureParent, { recursive: true, force: true });
      }
    },
  );

  it("appends content-free cause codes to statusless api_error diagnostics", async () => {
    const resultMarker = "private-api-error-cause-result";
    const error = await captureClaudeStructuredError({
      subtype: "success",
      terminal_reason: "api_error",
      result: `API Error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"${resultMarker}"}}`,
    });

    expect(error).toMatchObject({ code: "transient", retryable: true, status: null });
    expect(error.message).toBe("The user-session provider encountered a transient error.");
    expect(error.diagnostics).toEqual([
      { code: "claude_error_subtype_success", path: "subtype" },
      { code: "claude_terminal_reason_api_error", path: "terminal_reason" },
      { code: "claude_stop_reason_unavailable", path: "stop_reason" },
      { code: "claude_api_error_status_400", path: "result" },
      { code: "claude_api_error_type_invalid_request_error", path: "result" },
    ]);
    expect(error.message).not.toContain(resultMarker);
    expect(JSON.stringify(error.metadata)).not.toContain(resultMarker);
    expect(JSON.stringify(error.diagnostics)).not.toContain(resultMarker);
    expect(JSON.stringify(error)).not.toContain(resultMarker);
  });

  it.each([
    [
      "max_tokens",
      { output_tokens: 16_384, output_tokens_details: { thinking_tokens: 15_200 } },
      {
        code: "invalid-response",
        retryable: false,
        failureStage: "output-token-budget-exceeded",
        message: "The user-session runtime exceeded the requested output-token budget.",
        diagnostics: [
          {
            code: "claude_error_subtype_error_max_structured_output_retries",
            path: "subtype",
          },
          {
            code: "claude_terminal_reason_structured_output_retry_exhausted",
            path: "terminal_reason",
          },
          { code: "claude_stop_reason_max_tokens", path: "stop_reason" },
          { code: "output_token_budget_exceeded", path: "usage.outputTokens" },
        ],
      },
    ],
    [
      null,
      { input_tokens: 0, output_tokens: 0 },
      {
        code: "unknown",
        retryable: false,
        failureStage: null,
        message: "The user-session provider request failed.",
        diagnostics: [
          {
            code: "claude_error_subtype_error_max_structured_output_retries",
            path: "subtype",
          },
          {
            code: "claude_terminal_reason_structured_output_retry_exhausted",
            path: "terminal_reason",
          },
          { code: "claude_stop_reason_unavailable", path: "stop_reason" },
        ],
      },
    ],
  ] as const)(
    "classifies exhausted structured-output retries with stop reason %s",
    async (stopReason, usage, expected) => {
      const captureParent = await mkdtemp(join(tmpdir(), "draft-loop-claude-retry-exhausted-"));
      const resultMarker = "private-retry-exhausted-result";
      const errorsMarker = "private-retry-exhausted-errors";
      const sessionMarker = "private-retry-exhausted-session";
      const stderrMarker = "private-retry-exhausted-stderr";
      try {
        const error = await captureClaudeStructuredError(
          {
            subtype: "error_max_structured_output_retries",
            terminal_reason: "structured_output_retry_exhausted",
            stop_reason: stopReason,
            num_turns: 2,
            result: resultMarker,
            errors: [errorsMarker],
            session_id: sessionMarker,
            usage,
          },
          { captureParent, exitCode: 1, stderr: stderrMarker },
        );

        expect(error).toMatchObject({
          code: expected.code,
          retryable: expected.retryable,
          failureStage: expected.failureStage,
          status: null,
        });
        expect(error.message).toBe(expected.message);
        expect(error.diagnostics).toEqual(expected.diagnostics);
        expect(await readdir(captureParent)).toEqual([]);
        for (const marker of [resultMarker, errorsMarker, sessionMarker, stderrMarker]) {
          expect(error.message).not.toContain(marker);
          expect(JSON.stringify(error.metadata)).not.toContain(marker);
          expect(JSON.stringify(error.diagnostics)).not.toContain(marker);
          expect(JSON.stringify(error)).not.toContain(marker);
        }
      } finally {
        await rm(captureParent, { recursive: true, force: true });
      }
    },
  );

  it.each([
    [400, "unknown", false, "The user-session provider request failed."],
    [401, "authentication", false, "The user-session provider is not authenticated."],
    [403, "authentication", false, "The user-session provider is not authenticated."],
    [429, "rate-limit", true, "The user-session provider rate limit was reached."],
    [500, "transient", true, "The user-session provider encountered a transient error."],
  ] as const)(
    "keeps numeric Claude status %i ahead of api_error terminal reason",
    async (status, code, retryable, message) => {
      const resultMarker = `private-numeric-api-error-result-${status}`;
      const error = await captureClaudeStructuredError(
        {
          subtype: "success",
          terminal_reason: "api_error",
          api_error_status: status,
          result: resultMarker,
        },
        { stderr: `private-numeric-api-error-stderr-${status}` },
      );

      expect(error).toMatchObject({ code, retryable, status, metadata: { status } });
      expect(error.message).toBe(message);
      expect(error.diagnostics).toEqual([
        { code: "claude_error_subtype_success", path: "subtype" },
        { code: "claude_terminal_reason_api_error", path: "terminal_reason" },
        { code: "claude_stop_reason_unavailable", path: "stop_reason" },
      ]);
      expect(JSON.stringify(error)).not.toContain(resultMarker);
      expect(JSON.stringify(error)).not.toContain(`private-numeric-api-error-stderr-${status}`);
    },
  );

  it.each(claudeErrorDiagnosticCases)(
    "maps allowlisted Claude error $field value $value to a fixed diagnostic",
    async ({ field, value, code }) => {
      const error = await captureClaudeStructuredError({ [field]: value });

      expect(error.diagnostics).toHaveLength(3);
      expect(error.diagnostics).toContainEqual({ code, path: field });
      expect(error.diagnostics?.map(({ path }) => path)).toEqual([
        "subtype",
        "terminal_reason",
        "stop_reason",
      ]);
    },
  );

  it.each([
    ["omitted", {}],
    ["null", { subtype: null, terminal_reason: null, stop_reason: null }],
  ] as const)(
    "uses fixed unavailable diagnostics for %s Claude error fields",
    async (_case, fields) => {
      const error = await captureClaudeStructuredError(fields);

      expect(error).toMatchObject({ code: "unknown", retryable: false, status: null });
      expect(error.diagnostics).toEqual([
        { code: "claude_error_subtype_unavailable", path: "subtype" },
        { code: "claude_terminal_reason_unavailable", path: "terminal_reason" },
        { code: "claude_stop_reason_unavailable", path: "stop_reason" },
      ]);
    },
  );

  it.each(claudeErrorFieldPrefixes)(
    "uses an unrecognized diagnostic for malformed Claude error field %s",
    async (field, prefix) => {
      const marker = `malformed-${field}-sensitive-marker`;
      const error = await captureClaudeStructuredError({ [field]: { marker } });

      expect(error.diagnostics).toContainEqual({ code: `${prefix}_unrecognized`, path: field });
      expect(JSON.stringify(error)).not.toContain(marker);
    },
  );

  it.each(claudeErrorFieldPrefixes)(
    "uses an unrecognized diagnostic for future Claude error field %s values",
    async (field, prefix) => {
      const marker = `future-${field}-sensitive-marker`;
      const error = await captureClaudeStructuredError({ [field]: marker });

      expect(error.diagnostics).toContainEqual({ code: `${prefix}_unrecognized`, path: field });
      expect(JSON.stringify(error)).not.toContain(marker);
    },
  );

  it.each([0, 1] as const)(
    "captures only unknown Claude categories under an explicit private parent (exit %i)",
    async (exitCode) => {
      const captureParent = await mkdtemp(join(tmpdir(), "draft-loop-claude-capture-test-"));
      const markers = [
        "private-stop-reason-marker",
        "private-result-prose-marker",
        "private-errors-array-marker",
        "private-session-id-marker",
        "private-usage-marker",
        "private-structured-output-marker",
        "private-prompt-marker",
        "private-stdout-marker",
        "private-stderr-marker",
        "private-environment-marker",
        "synthetic-secret-credential-marker",
      ];
      try {
        const subtype = "future_error_category";
        const terminalReason = "future_terminal_category";
        const error = await captureClaudeStructuredError(
          {
            subtype,
            terminal_reason: terminalReason,
            stop_reason: markers[0],
            result: markers[1],
            errors: [markers[2]],
            session_id: markers[3],
            usage: { private: markers[4] },
            structured_output: { private: markers[5] },
            prompt: markers[6],
            stdout: markers[7],
            env: markers[8],
            api_key: markers[10],
            path: "/synthetic/private/path-marker",
            url: "https://private.invalid/private-marker",
            api_error_status: 503,
          },
          {
            captureParent,
            stderr: "private-stderr-marker",
            exitCode,
            environment: {
              ANTHROPIC_API_KEY: markers[10],
              PRIVATE_ENV: markers[9],
            },
          },
        );

        const directories = await readdir(captureParent);
        expect(directories).toHaveLength(1);
        const captureDirectoryName = directories[0];
        if (captureDirectoryName === undefined) throw new Error("Expected a capture directory.");
        const captureDirectory = join(captureParent, captureDirectoryName);
        const captureFile = join(captureDirectory, "categories.json");
        const capturedText = await readFile(captureFile, "utf8");
        const captured = JSON.parse(capturedText) as Record<string, unknown>;

        expect(captureDirectoryName).toMatch(/^claude-category-[0-9a-f-]{36}$/u);
        expect((await stat(captureDirectory)).mode & 0o777).toBe(0o700);
        expect((await stat(captureFile)).mode & 0o777).toBe(0o600);
        expect(captured).toEqual({ subtype, terminal_reason: terminalReason });
        expect(error.diagnostics).toEqual([
          { code: "claude_error_subtype_unrecognized", path: "subtype" },
          { code: "claude_terminal_reason_unrecognized", path: "terminal_reason" },
          { code: "claude_stop_reason_unrecognized", path: "stop_reason" },
          {
            code: "local_claude_category_capture_saved",
            path: "local_claude_category_capture",
          },
        ]);
        expect(error).toMatchObject({
          code: "transient",
          retryable: true,
          status: 503,
          metadata: { status: 503 },
        });
        expect(error.message).toBe("The user-session provider encountered a transient error.");
        expect(JSON.stringify(error)).not.toContain(captureParent);
        expect(JSON.stringify(error)).not.toContain(captureDirectoryName);
        expect(JSON.stringify(error)).not.toContain(subtype);
        expect(JSON.stringify(error)).not.toContain(terminalReason);
        expect(capturedText).not.toContain("/synthetic/private/path-marker");
        expect(capturedText).not.toContain("https://private.invalid/private-marker");
        for (const marker of markers) {
          expect(capturedText).not.toContain(marker);
          expect(error.message).not.toContain(marker);
          expect(JSON.stringify(error)).not.toContain(marker);
        }
      } finally {
        await rm(captureParent, { recursive: true, force: true });
      }
    },
  );

  it("does not capture unknown categories unless an explicit parent is configured", async () => {
    const subtype = "future_private_category_marker";
    const error = await captureClaudeStructuredError({ subtype });

    expect(error.diagnostics).toContainEqual({
      code: "claude_error_subtype_unrecognized",
      path: "subtype",
    });
    expect(error.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: expect.stringMatching(/^local_claude_category_capture_/u) }),
    );
    expect(error.message).not.toContain(subtype);
    expect(JSON.stringify(error)).not.toContain(subtype);
  });

  it.each([
    ["known categories", { subtype: "error_max_turns", terminal_reason: "model_error" }],
    ["missing and non-string categories", { terminal_reason: null }],
    [
      "malformed categories",
      { subtype: { marker: "private-malformed-marker" }, terminal_reason: "provider prose" },
    ],
  ] as const)("does not capture %s", async (_case, fields) => {
    const captureParent = await mkdtemp(join(tmpdir(), "draft-loop-claude-capture-test-"));
    try {
      const error = await captureClaudeStructuredError(fields, { captureParent });

      expect(await readdir(captureParent)).toEqual([]);
      expect(error.diagnostics).not.toContainEqual(
        expect.objectContaining({
          code: expect.stringMatching(/^local_claude_category_capture_/u),
        }),
      );
      expect(JSON.stringify(error)).not.toContain("private-malformed-marker");
    } finally {
      await rm(captureParent, { recursive: true, force: true });
    }
  });

  it("fails closed without copying an oversized category or partially saving another", async () => {
    const captureParent = await mkdtemp(join(tmpdir(), "draft-loop-claude-capture-test-"));
    const oversized = `future_${"x".repeat(128)}`;
    try {
      const error = await captureClaudeStructuredError(
        { subtype: "future_safe_category", terminal_reason: oversized },
        { captureParent },
      );

      expect(await readdir(captureParent)).toEqual([]);
      expect(error.diagnostics).toContainEqual({
        code: "local_claude_category_capture_failed",
        path: "local_claude_category_capture",
      });
      expect(error.message).not.toContain(oversized);
      expect(JSON.stringify(error)).not.toContain(oversized);
    } finally {
      await rm(captureParent, { recursive: true, force: true });
    }
  });

  it("reports a fixed failure when the selected capture parent does not exist", async () => {
    const temporaryParent = await mkdtemp(join(tmpdir(), "draft-loop-claude-capture-test-"));
    const missingParent = join(temporaryParent, "not-created");
    try {
      const error = await captureClaudeStructuredError(
        { subtype: "future_category" },
        { captureParent: missingParent },
      );

      expect(await readdir(temporaryParent)).toEqual([]);
      expect(error.diagnostics).toContainEqual({
        code: "local_claude_category_capture_failed",
        path: "local_claude_category_capture",
      });
      expect(error.message).not.toContain(missingParent);
      expect(JSON.stringify(error)).not.toContain(missingParent);
    } finally {
      await rm(temporaryParent, { recursive: true, force: true });
    }
  });

  it.each(["malformed", "array", "scalar", "unrecognized", "success-shaped"] as const)(
    "uses the existing safe generic fallback for nonzero %s Claude output",
    async (shape) => {
      const marker = `synthetic-${shape}-provider-output`;
      const stdout =
        shape === "malformed"
          ? `not-json ${marker}`
          : shape === "array"
            ? JSON.stringify([
                { type: "result", is_error: true, api_error_status: 500, result: marker },
              ])
            : shape === "scalar"
              ? JSON.stringify(marker)
              : shape === "unrecognized"
                ? JSON.stringify({
                    type: "message",
                    is_error: true,
                    api_error_status: 500,
                    result: marker,
                  })
                : JSON.stringify({
                    type: "result",
                    subtype: "success",
                    is_error: false,
                    session_id: "session",
                    structured_output: { marker },
                    usage: { input_tokens: 1, output_tokens: 1 },
                  });
      const stderrMarker = `synthetic-${shape}-stderr`;
      const adapter = new AnthropicClaudeUserSessionAdapter({
        configuredModel: anthropicModel,
        runner: async () => ({ exitCode: 1, stdout, stderr: stderrMarker }),
      });

      try {
        await adapter.execute(request(anthropicModel));
        throw new Error("expected rejection");
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderAdapterError);
        expect(error).toMatchObject({ code: "unknown", retryable: false });
        expect((error as ProviderAdapterError).status).toBe(null);
        for (const value of [marker, stderrMarker]) {
          expect((error as Error).message).not.toContain(value);
          expect(JSON.stringify((error as ProviderAdapterError).metadata)).not.toContain(value);
          expect(JSON.stringify((error as ProviderAdapterError).diagnostics)).not.toContain(value);
          expect(JSON.stringify(error)).not.toContain(value);
        }
      }
    },
  );

  it.each([1, maximumUserSessionTimeoutMs])(
    "forwards configured timeout %s to the Claude runner",
    async (timeoutMs) => {
      const runner = vi.fn<UserSessionProcessRunner>(async (_command, _args, options) => {
        expect(options.timeoutMs).toBe(timeoutMs);
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            type: "result",
            subtype: "success",
            is_error: false,
            session_id: "claude-session",
            structured_output: { answer: "yes" },
            usage: { input_tokens: 1, output_tokens: 1 },
            permission_denials: [],
          }),
          stderr: "",
        };
      });
      const adapter = new AnthropicClaudeUserSessionAdapter({
        configuredModel: anthropicModel,
        runner,
        timeoutMs,
      });

      await expect(adapter.execute(request(anthropicModel))).resolves.toMatchObject({
        output: { answer: "yes" },
      });
    },
  );
});

describe("AnthropicClaudeUserSessionAdapter effort", () => {
  const baselineEnvironment = { HOME: "/login-store", KEEP: "yes" } as const;
  // Recorded from the adapter before the effort option existed; the absent
  // option must keep these arguments and this environment byte-identical.
  const baselineArgs = [
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
    "--prompt-suggestions",
    "false",
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
  ] as const;
  const baselineEnvironmentByBudget = {
    20: {
      HOME: "/login-store",
      KEEP: "yes",
      CLAUDE_CODE_DISABLE_TERMINAL_TITLE: "1",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      CLAUDE_CODE_MAX_OUTPUT_TOKENS: "20",
      MAX_THINKING_TOKENS: "0",
      CLAUDE_CODE_DISABLE_THINKING: "1",
      CLAUDE_CODE_MAX_RETRIES: "0",
      MAX_STRUCTURED_OUTPUT_RETRIES: "0",
    },
    16384: {
      HOME: "/login-store",
      KEEP: "yes",
      CLAUDE_CODE_DISABLE_TERMINAL_TITLE: "1",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      CLAUDE_CODE_MAX_OUTPUT_TOKENS: "16384",
      MAX_THINKING_TOKENS: "8192",
      CLAUDE_CODE_MAX_RETRIES: "0",
      MAX_STRUCTURED_OUTPUT_RETRIES: "0",
    },
  } as const;

  async function recordInvocation(
    maxOutputTokens: 20 | 16_384,
    effort?: unknown,
  ): Promise<{ readonly args: readonly string[]; readonly env: Record<string, unknown> }> {
    const calls: { readonly args: readonly string[]; readonly env: Record<string, unknown> }[] = [];
    const adapter = new AnthropicClaudeUserSessionAdapter({
      configuredModel: anthropicModel,
      environment: baselineEnvironment,
      ...(effort === undefined ? {} : { effort: effort as ClaudeEffortLevel }),
      runner: async (_command, args, options) => {
        calls.push({ args: [...args], env: { ...options.env } });
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            type: "result",
            subtype: "success",
            is_error: false,
            session_id: "claude-session",
            structured_output: { answer: "yes" },
            usage: { input_tokens: 1, output_tokens: 1 },
            permission_denials: [],
          }),
          stderr: "",
        };
      },
    });
    await adapter.execute(request(anthropicModel, { maxOutputTokens }));
    expect(calls).toHaveLength(1);
    const [call] = calls;
    if (call === undefined) throw new Error("Expected one runner call.");
    return call;
  }

  it.each([20, 16_384] as const)(
    "keeps arguments and environment unchanged without an effort (budget %i)",
    async (maxOutputTokens) => {
      const call = await recordInvocation(maxOutputTokens);

      expect(call.args).toEqual(baselineArgs);
      expect(call.env).toStrictEqual(baselineEnvironmentByBudget[maxOutputTokens]);
    },
  );

  it.each(claudeEffortLevels)(
    "adds only --effort %s immediately after the model",
    async (effort) => {
      for (const maxOutputTokens of [20, 16_384] as const) {
        const call = await recordInvocation(maxOutputTokens, effort);
        const modelIndex = baselineArgs.indexOf("--model");

        expect(call.args).toEqual([
          ...baselineArgs.slice(0, modelIndex + 2),
          "--effort",
          effort,
          ...baselineArgs.slice(modelIndex + 2),
        ]);
        expect(call.env).toStrictEqual(baselineEnvironmentByBudget[maxOutputTokens]);
      }
    },
  );

  it.each(["", "LOW", "minimal", "ultra", 3, null])(
    "rejects the invalid effort level %j before any runner call",
    (effort) => {
      const runner = vi.fn<UserSessionProcessRunner>();
      let thrown: unknown;
      try {
        new AnthropicClaudeUserSessionAdapter({
          configuredModel: anthropicModel,
          runner,
          effort: effort as unknown as ClaudeEffortLevel,
        });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(ProviderAdapterError);
      const error = thrown as ProviderAdapterError;
      expect(error.provider).toBe("anthropic");
      expect(error.code).toBe("invalid-request");
      expect(error.retryable).toBe(false);
      expect(error.message).toBe("The effort level is invalid.");
      expect(error.diagnostics).toEqual([{ code: "invalid_effort_level", path: "effort" }]);
      expect(runner).not.toHaveBeenCalled();
    },
  );
});

describe("OpenAICodexUserSessionAdapter", () => {
  it("uses locked-down Codex argv/config, private files, scrubbed environment, and JSONL usage", async () => {
    const runner = vi.fn<UserSessionProcessRunner>(async (command, args, options) => {
      expect(command).toBe("codex-test");
      expect(options.timeoutMs).toBe(defaultUserSessionTimeoutMs);
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
      expectEnvironmentWithoutNames(options.env, openAISecretEnvironmentNames);
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
            type: "item.started",
            item: { type: "reasoning" },
          }),
          JSON.stringify({
            type: "item.completed",
            item: { type: "reasoning", text: "must not be projected" },
          }),
          JSON.stringify({
            type: "item.started",
            item: {
              type: "todo_list",
              id: "todo-list-1",
              items: [{ text: "Draft the answer", completed: false }],
            },
          }),
          JSON.stringify({
            type: "item.updated",
            item: {
              type: "todo_list",
              id: "todo-list-1",
              items: [{ text: "Draft the answer", completed: true }],
            },
          }),
          JSON.stringify({
            type: "item.completed",
            item: {
              type: "todo_list",
              id: "todo-list-1",
              items: [{ text: "Draft the answer", completed: true }],
            },
          }),
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
        openai_api_key: "mixed-case-secret",
        CODEX_API_KEY: "secret",
        CoDeX_ApI_KeY: "mixed-case-secret",
        OPENAI_BASE_URL: "https://override.invalid",
        oPeNaI_bAsE_uRl: "https://mixed-case-override.invalid",
      },
    });

    const response = await adapter.execute(request(openAIModel));
    expect(response).toMatchObject({
      output: { answer: "yes" },
      provider: "openai",
      company: "openai",
      modelId: "gpt-exact",
      providerRequestId: "codex-thread",
      usage: { inputTokens: 12, outputTokens: 3, totalTokens: 15 },
      cost: { estimatedUsd: null },
    });
    expect(response).not.toHaveProperty("todo_list");
    expect(response).not.toHaveProperty("items");
    expect(response).not.toHaveProperty("reasoning");
    expect(JSON.stringify(response)).not.toContain("Draft the answer");
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

  it.each([1, maximumUserSessionTimeoutMs])(
    "forwards configured timeout %s to the Codex runner",
    async (timeoutMs) => {
      const runner = vi.fn<UserSessionProcessRunner>(async (_command, args, options) => {
        expect(options.timeoutMs).toBe(timeoutMs);
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
        configuredModel: openAIModel,
        runner,
        timeoutMs,
      });

      await expect(adapter.execute(request(openAIModel))).resolves.toMatchObject({
        output: { answer: "yes" },
      });
    },
  );

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

  it("rejects prohibited item.updated types before reading a valid final response", async () => {
    const runner: UserSessionProcessRunner = async (_command, args) => {
      const outputPath = args[args.indexOf("--output-last-message") + 1];
      if (outputPath === undefined) throw new Error("output path missing");
      await writeFile(outputPath, '{"answer":"unsafe"}');
      return {
        exitCode: 0,
        stdout: [
          JSON.stringify({ type: "thread.started", thread_id: "thread" }),
          JSON.stringify({
            type: "item.updated",
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
      message: "The user-session runtime exceeded the requested output-token budget.",
      retryable: false,
      failureStage: "output-token-budget-exceeded",
      diagnostics: [{ code: "output_token_budget_exceeded", path: "usage.outputTokens" }],
    });
  });
});

describe("user-session error normalization and login probes", () => {
  it.each([0, 1.5, maximumUserSessionTimeoutMs + 1])(
    "rejects invalid timeout %s during adapter construction before runner invocation",
    (timeoutMs) => {
      const anthropicRunner = vi.fn<UserSessionProcessRunner>();
      const openAIRunner = vi.fn<UserSessionProcessRunner>();
      expect(
        () =>
          new AnthropicClaudeUserSessionAdapter({
            configuredModel: anthropicModel,
            runner: anthropicRunner,
            timeoutMs,
          }),
      ).toThrow("The user-session timeout is invalid.");
      expect(
        () =>
          new OpenAICodexUserSessionAdapter({
            configuredModel: openAIModel,
            runner: openAIRunner,
            timeoutMs,
          }),
      ).toThrow("The user-session timeout is invalid.");
      expect(anthropicRunner).not.toHaveBeenCalled();
      expect(openAIRunner).not.toHaveBeenCalled();
    },
  );

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
      expectEnvironmentWithoutNames(options.env, [
        ...anthropicSecretEnvironmentNames,
        ...openAISecretEnvironmentNames,
      ]);
      return { exitCode: command === "claude-custom" ? 0 : 1, stdout: "identity", stderr: "token" };
    };
    await expect(
      probeAnthropicClaudeUserSession({
        command: "claude-custom",
        runner,
        environment: {
          anthropic_api_key: "mixed-case-secret",
          Anthropic_Auth_Token: "mixed-case-secret",
          aNtHrOpIc_BaSe_Url: "https://mixed-case-override.invalid",
        },
      }),
    ).resolves.toEqual({ available: true, authenticated: true });
    await expect(
      probeOpenAICodexUserSession({
        command: "codex-custom",
        runner,
        environment: {
          openai_api_key: "mixed-case-secret",
          CoDeX_ApI_KeY: "mixed-case-secret",
          oPeNaI_bAsE_uRl: "https://mixed-case-override.invalid",
        },
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
