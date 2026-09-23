import type { ModelSelection } from "@draft-loop/domain";
import { describe, expect, it } from "vitest";

import {
  type AuthorModelPreflightResult,
  preflightAnthropicClaudeAuthorModel,
  UserSessionProcessError,
  type UserSessionProcessOptions,
  type UserSessionProcessResult,
  type UserSessionProcessRunner,
} from "./index.js";

const declaredModel: ModelSelection = {
  company: "anthropic",
  modelId: "claude-declared-author",
  role: "author",
  promptTemplateVersion: "author-v1",
};
const sentinel = "private-sentinel-response-text";

interface RecordedCall {
  readonly command: string;
  readonly args: readonly string[];
  readonly options: UserSessionProcessOptions;
}

function fakeRunner(respond: () => Promise<UserSessionProcessResult> | UserSessionProcessResult): {
  readonly runner: UserSessionProcessRunner;
  readonly calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const runner: UserSessionProcessRunner = async (command, args, options) => {
    calls.push({ command, args, options });
    return respond();
  };
  return { runner, calls };
}

function claudeResult(fields: Readonly<Record<string, unknown>>, exitCode = 0) {
  return (): UserSessionProcessResult => ({
    exitCode,
    stdout: JSON.stringify({ type: "result", ...fields }),
    stderr: `stderr ${sentinel}`,
  });
}

function claudeSuccess(structuredOutput: unknown) {
  return claudeResult({
    subtype: "success",
    is_error: false,
    session_id: "synthetic-preflight-session",
    result: sentinel,
    structured_output: structuredOutput,
    usage: { input_tokens: 5, output_tokens: 3 },
  });
}

function claudeError(fields: Readonly<Record<string, unknown>>, exitCode = 1) {
  return claudeResult({ is_error: true, result: sentinel, ...fields }, exitCode);
}

async function preflight(
  respond: () => Promise<UserSessionProcessResult> | UserSessionProcessResult,
): Promise<{ readonly result: AuthorModelPreflightResult; readonly calls: RecordedCall[] }> {
  const { runner, calls } = fakeRunner(respond);
  const result = await preflightAnthropicClaudeAuthorModel({
    model: declaredModel,
    runner,
    environment: {},
  });
  expect(JSON.stringify(result)).not.toContain(sentinel);
  return { result, calls };
}

describe("preflightAnthropicClaudeAuthorModel", () => {
  it("reports an available model after one synthetic request to the declared model", async () => {
    const { result, calls } = await preflight(claudeSuccess({ ready: true }));

    expect(result).toEqual({ status: "available", errorCode: null, diagnosticCodes: [] });
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.command).toBe("claude");
    const modelIndex = call?.args.indexOf("--model") ?? -1;
    expect(modelIndex).toBeGreaterThanOrEqual(0);
    expect(call?.args[modelIndex + 1]).toBe("claude-declared-author");
    expect(JSON.parse(call?.options.stdin ?? "null")).toEqual({ check: "author-model-preflight" });
    expect(call?.options.timeoutMs).toBe(60_000);
    // The default tracks the newest author prompt budget (cli-author-v3).
    expect(call?.options.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS).toBe("16384");
    expect(call?.options.env.MAX_THINKING_TOKENS).toBe("8192");
    expect(call?.options.env.CLAUDE_CODE_DISABLE_THINKING).toBeUndefined();
    const schemaIndex = call?.args.indexOf("--json-schema") ?? -1;
    expect(JSON.parse(call?.args[schemaIndex + 1] ?? "null")).toEqual({
      type: "object",
      properties: { ready: { type: "boolean" } },
      required: ["ready"],
      additionalProperties: false,
    });
  });

  it("uses an explicit author output budget when one is declared", async () => {
    const { runner, calls } = fakeRunner(claudeSuccess({ ready: true }));
    const result = await preflightAnthropicClaudeAuthorModel({
      model: declaredModel,
      runner,
      environment: {},
      maxOutputTokens: 4_096,
    });

    expect(result.status).toBe("available");
    expect(calls[0]?.options.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS).toBe("4096");
    expect(calls[0]?.options.env.MAX_THINKING_TOKENS).toBe("2048");
  });

  it("reports the observed statusless api_error shape as an api error", async () => {
    const { result, calls } = await preflight(
      claudeError({
        subtype: "success",
        terminal_reason: "api_error",
        stop_reason: "stop_sequence",
        errors: [sentinel],
        session_id: sentinel,
      }),
    );

    expect(calls).toHaveLength(1);
    expect(result).toEqual({
      status: "api-error",
      errorCode: "transient",
      diagnosticCodes: [
        "claude_error_subtype_success",
        "claude_terminal_reason_api_error",
        "claude_stop_reason_stop_sequence",
      ],
    });
  });

  it("reports a 404 API status as an unavailable model", async () => {
    const { result } = await preflight(
      claudeError({ subtype: "success", api_error_status: 404, terminal_reason: "api_error" }),
    );

    expect(result.status).toBe("model-unavailable");
    expect(result.errorCode).toBe("unknown");
    expect(result.diagnosticCodes).toContain("claude_terminal_reason_api_error");
  });

  it("reports a model_error terminal reason as an unavailable model", async () => {
    const { result } = await preflight(
      claudeError({ subtype: "success", terminal_reason: "model_error" }),
    );

    expect(result.status).toBe("model-unavailable");
    expect(result.diagnosticCodes).toContain("claude_terminal_reason_model_error");
  });

  it("reports a process timeout as a timeout", async () => {
    const { result, calls } = await preflight(() => {
      throw new UserSessionProcessError("timeout");
    });

    expect(calls).toHaveLength(1);
    expect(result).toEqual({ status: "timeout", errorCode: "timeout", diagnosticCodes: [] });
  });

  it("reports an authentication failure as unavailable with its error code", async () => {
    const { result } = await preflight(claudeError({ subtype: "success", api_error_status: 401 }));

    expect(result.status).toBe("unavailable");
    expect(result.errorCode).toBe("authentication");
  });

  it("reports a missing runtime as unavailable", async () => {
    const { result } = await preflight(() => {
      throw new UserSessionProcessError("missing-runtime");
    });

    expect(result).toEqual({
      status: "unavailable",
      errorCode: "invalid-request",
      diagnosticCodes: ["runtime_unavailable"],
    });
  });

  it("reports a structured reply that is not ready as an invalid response", async () => {
    const { result } = await preflight(claudeSuccess({ ready: false }));

    expect(result).toEqual({
      status: "unavailable",
      errorCode: "invalid-response",
      diagnosticCodes: [],
    });
  });

  it("reports an unexpected runner failure as unavailable without its message", async () => {
    const { result } = await preflight(() => {
      throw new Error(sentinel);
    });

    expect(result.status).toBe("unavailable");
  });
});
