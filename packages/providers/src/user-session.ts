import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ModelSelection } from "@draft-loop/domain";

import {
  assertDataExposureAllowed,
  type JsonValue,
  type ModelRequest,
  type ModelResponse,
  ProviderAdapterError,
} from "./index.js";

export const defaultUserSessionTimeoutMs = 120_000;
export const maximumUserSessionTimeoutMs = 1_200_000;
const defaultMaxOutputBytes = 1_048_576;
const maximumMaxOutputTokens = 32_768;
const defaultMaxOutputTokens = 4_096;

const anthropicSecretEnvironmentNames = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
] as const;
const openAISecretEnvironmentNames = [
  "OPENAI_API_KEY",
  "CODEX_API_KEY",
  "OPENAI_BASE_URL",
] as const;

export interface UserSessionProcessOptions {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly stdin: string;
  readonly signal?: AbortSignal;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
}

export interface UserSessionProcessResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export type UserSessionProcessRunner = (
  command: string,
  args: readonly string[],
  options: UserSessionProcessOptions,
) => Promise<UserSessionProcessResult>;

type ProcessFailureReason = "cancelled" | "missing-runtime" | "output-limit" | "spawn" | "timeout";

/** A runner-level failure without subprocess output or credentials. */
export class UserSessionProcessError extends Error {
  readonly reason: ProcessFailureReason;

  constructor(reason: ProcessFailureReason) {
    super(`The user-session process failed (${reason}).`);
    this.name = "UserSessionProcessError";
    this.reason = reason;
  }
}

function terminateProcessTree(child: ReturnType<typeof spawn>): void {
  if (child.pid === undefined) return;
  try {
    if (process.platform === "win32") {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        shell: false,
        stdio: "ignore",
        windowsHide: true,
      });
      killer.unref();
    } else {
      process.kill(-child.pid, "SIGKILL");
    }
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      // The child may already have exited.
    }
  }
}

export const runUserSessionProcess: UserSessionProcessRunner = async (command, args, options) =>
  new Promise<UserSessionProcessResult>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let settled = false;
    let timedOut = false;

    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: { ...options.env },
      detached: process.platform !== "win32",
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    const finishWithError = (error: UserSessionProcessError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      terminateProcessTree(child);
      reject(error);
    };
    const append = (target: "stderr" | "stdout", chunk: Buffer | string) => {
      const text = chunk.toString();
      outputBytes += Buffer.byteLength(text);
      if (outputBytes > options.maxOutputBytes) {
        finishWithError(new UserSessionProcessError("output-limit"));
        return;
      }
      if (target === "stdout") stdout += text;
      else stderr += text;
    };
    const abort = () => finishWithError(new UserSessionProcessError("cancelled"));
    const timer = setTimeout(() => {
      timedOut = true;
      finishWithError(new UserSessionProcessError("timeout"));
    }, options.timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => append("stdout", chunk));
    child.stderr?.on("data", (chunk: Buffer) => append("stderr", chunk));
    child.on("error", (error: NodeJS.ErrnoException) => {
      finishWithError(
        new UserSessionProcessError(error.code === "ENOENT" ? "missing-runtime" : "spawn"),
      );
    });
    child.on("close", (exitCode) => {
      if (settled || timedOut) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      resolve({ exitCode, stdout, stderr });
    });

    if (options.signal?.aborted) {
      abort();
      return;
    }
    options.signal?.addEventListener("abort", abort, { once: true });
    child.stdin?.end(options.stdin, "utf8");
  });

export interface UserSessionAdapterOptions {
  readonly configuredModel: ModelSelection;
  readonly runner?: UserSessionProcessRunner;
  readonly command?: string;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly environment?: Readonly<Record<string, string | undefined>>;
}

export interface UserSessionLoginStatus {
  readonly available: boolean;
  readonly authenticated: boolean;
}

export interface UserSessionProbeOptions {
  readonly runner?: UserSessionProcessRunner;
  readonly command?: string;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly environment?: Readonly<Record<string, string | undefined>>;
}

function sanitizedEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  names: readonly string[],
): Record<string, string | undefined> {
  const normalizedNames = new Set(names.map((name) => asciiLowercase(name)));
  const sanitized = { ...environment };
  for (const name of Object.keys(sanitized)) {
    if (normalizedNames.has(asciiLowercase(name))) delete sanitized[name];
  }
  return sanitized;
}

function asciiLowercase(value: string): string {
  return value.replace(/[A-Z]/gu, (character) =>
    String.fromCharCode(character.charCodeAt(0) + 0x20),
  );
}

async function withPrivateTemporaryDirectory<T>(
  action: (directory: string) => Promise<T>,
): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "draft-loop-provider-"));
  await chmod(directory, 0o700);
  try {
    return await action(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function assertExactModel(
  provider: "anthropic" | "openai",
  configured: ModelSelection,
  requested: ModelSelection,
): void {
  if (
    configured.company.trim() !== provider ||
    requested.company.trim() !== provider ||
    configured.modelId !== requested.modelId ||
    configured.role !== requested.role ||
    configured.promptTemplateVersion !== requested.promptTemplateVersion
  ) {
    throw new ProviderAdapterError(
      provider,
      "invalid-request",
      "The request model does not match the exact configured provider model.",
      { retryable: false },
    );
  }
}

function resolveOutputTokenLimit(
  provider: "anthropic" | "openai",
  value: number | undefined,
): number {
  const limit = value ?? defaultMaxOutputTokens;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maximumMaxOutputTokens) {
    throw new ProviderAdapterError(
      provider,
      "invalid-request",
      "The output-token budget is invalid.",
      {
        retryable: false,
        diagnostics: [{ code: "invalid_output_token_budget", path: "maxOutputTokens" }],
      },
    );
  }
  return limit;
}

function resolveUserSessionTimeout(
  provider: "anthropic" | "openai",
  value: number | undefined,
): number {
  const timeoutMs = value ?? defaultUserSessionTimeoutMs;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > maximumUserSessionTimeoutMs
  ) {
    throw new ProviderAdapterError(
      provider,
      "invalid-request",
      "The user-session timeout is invalid.",
      {
        retryable: false,
        diagnostics: [{ code: "invalid_user_session_timeout", path: "timeoutMs" }],
      },
    );
  }
  return timeoutMs;
}

function validTokenCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function structuredOutput<Output extends JsonValue>(
  provider: "anthropic" | "openai",
  value: unknown,
  path: string,
): Output {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error("not JSON");
    return JSON.parse(serialized) as Output;
  } catch {
    throw new ProviderAdapterError(
      provider,
      "invalid-response",
      "The provider returned invalid JSON output.",
      {
        retryable: false,
        diagnostics: [{ code: "invalid_json", path }],
      },
    );
  }
}

function parseJson<Output extends JsonValue>(
  provider: "anthropic" | "openai",
  text: unknown,
  path: string,
): Output {
  if (typeof text !== "string" || text.trim() === "") {
    throw new ProviderAdapterError(
      provider,
      "invalid-response",
      "The provider returned no structured output.",
      {
        retryable: false,
        diagnostics: [{ code: "missing_output", path }],
      },
    );
  }
  try {
    return structuredOutput<Output>(provider, JSON.parse(text), path);
  } catch (error) {
    if (error instanceof ProviderAdapterError) throw error;
    throw new ProviderAdapterError(
      provider,
      "invalid-response",
      "The provider returned invalid JSON output.",
      {
        retryable: false,
        diagnostics: [{ code: "invalid_json", path }],
      },
    );
  }
}

function responseHash(value: JsonValue): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function assertOutputWithinLimit(
  provider: "anthropic" | "openai",
  outputTokens: number,
  limit: number,
): void {
  if (outputTokens <= limit) return;
  throw new ProviderAdapterError(
    provider,
    "invalid-response",
    "The user-session runtime exceeded the requested output-token budget.",
    {
      retryable: false,
      diagnostics: [{ code: "output_token_budget_exceeded", path: "usage.outputTokens" }],
    },
  );
}

function resultOrError(
  provider: "anthropic" | "openai",
  result: UserSessionProcessResult,
): UserSessionProcessResult {
  if (result.exitCode === 0) return result;
  const details = `${result.stdout}\n${result.stderr}`.toLowerCase();
  let code: "authentication" | "quota-exhausted" | "rate-limit" | "unknown" = "unknown";
  if (
    details.includes("not logged in") ||
    details.includes("login required") ||
    details.includes("authentication") ||
    details.includes("unauthorized")
  ) {
    code = "authentication";
  } else if (
    details.includes("insufficient_quota") ||
    details.includes("quota exhausted") ||
    details.includes("quota exceeded") ||
    details.includes("weekly limit") ||
    details.includes("usage limit")
  ) {
    code = "quota-exhausted";
  } else if (
    details.includes("rate limit") ||
    details.includes("rate_limit") ||
    details.includes("too many requests")
  ) {
    code = "rate-limit";
  }
  throw new ProviderAdapterError(
    provider,
    code,
    code === "unknown"
      ? "The user-session provider request failed."
      : `The user-session provider request failed (${code}).`,
    { retryable: code === "rate-limit" },
  );
}

function normalizeProcessError(
  provider: "anthropic" | "openai",
  error: unknown,
): ProviderAdapterError {
  if (error instanceof ProviderAdapterError) return error;
  if (error instanceof UserSessionProcessError) {
    if (error.reason === "cancelled") {
      return new ProviderAdapterError(
        provider,
        "cancelled",
        "The user-session request was cancelled.",
        {
          retryable: false,
        },
      );
    }
    if (error.reason === "timeout") {
      return new ProviderAdapterError(provider, "timeout", "The user-session request timed out.");
    }
    if (error.reason === "missing-runtime") {
      return new ProviderAdapterError(
        provider,
        "invalid-request",
        "The required user-session runtime is not installed or is unavailable.",
        { retryable: false, diagnostics: [{ code: "runtime_unavailable", path: "runtime" }] },
      );
    }
    if (error.reason === "output-limit") {
      return new ProviderAdapterError(
        provider,
        "invalid-response",
        "The user-session runtime produced too much process output.",
        { retryable: false, diagnostics: [{ code: "process_output_limit", path: "runtime" }] },
      );
    }
  }
  return new ProviderAdapterError(
    provider,
    "unknown",
    "The user-session provider request failed.",
    {
      retryable: false,
    },
  );
}

function assertBoundedResult(
  provider: "anthropic" | "openai",
  result: UserSessionProcessResult,
  maxOutputBytes: number,
): void {
  if (Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) <= maxOutputBytes) return;
  throw new ProviderAdapterError(
    provider,
    "invalid-response",
    "The user-session runtime produced too much process output.",
    { retryable: false, diagnostics: [{ code: "process_output_limit", path: "runtime" }] },
  );
}

interface ClaudeJsonResult {
  readonly type?: unknown;
  readonly subtype?: unknown;
  readonly is_error?: unknown;
  readonly api_error_status?: unknown;
  readonly result?: unknown;
  readonly session_id?: unknown;
  readonly structured_output?: unknown;
  readonly usage?: unknown;
  readonly permission_denials?: unknown;
  readonly tool_use?: unknown;
  readonly tool_uses?: unknown;
}

function parseClaudeResult<Output extends JsonValue>(
  text: string,
): {
  readonly output: Output;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly sessionId: string;
} {
  const response = parseJson<JsonValue>("anthropic", text, "stdout") as ClaudeJsonResult;
  const usage = response.usage as
    | { readonly input_tokens?: unknown; readonly output_tokens?: unknown }
    | undefined;
  const hasToolUse =
    response.tool_use !== undefined ||
    response.tool_uses !== undefined ||
    (Array.isArray(response.permission_denials) && response.permission_denials.length > 0);
  if (hasToolUse) {
    throw new ProviderAdapterError(
      "anthropic",
      "invalid-response",
      "The user-session runtime attempted prohibited tool use.",
      { retryable: false, diagnostics: [{ code: "tool_use_reported", path: "stdout" }] },
    );
  }
  if (response.is_error === true) {
    const safeResult = typeof response.result === "string" ? response.result.toLowerCase() : "";
    if (response.api_error_status === 429) {
      const quota =
        safeResult.includes("weekly limit") ||
        safeResult.includes("usage limit") ||
        safeResult.includes("quota");
      throw new ProviderAdapterError(
        "anthropic",
        quota ? "quota-exhausted" : "rate-limit",
        quota
          ? "The user-session provider quota is exhausted."
          : "The user-session provider rate limit was reached.",
        { retryable: !quota },
      );
    }
    if (response.api_error_status === 401 || response.api_error_status === 403) {
      throw new ProviderAdapterError(
        "anthropic",
        "authentication",
        "The user-session provider is not authenticated.",
        { retryable: false },
      );
    }
    throw new ProviderAdapterError(
      "anthropic",
      "unknown",
      "The user-session provider request failed.",
      { retryable: false },
    );
  }
  if (
    response.type !== "result" ||
    response.subtype !== "success" ||
    response.is_error !== false ||
    typeof response.session_id !== "string" ||
    response.session_id.trim() === "" ||
    response.structured_output === undefined ||
    !validTokenCount(usage?.input_tokens) ||
    !validTokenCount(usage.output_tokens)
  ) {
    throw new ProviderAdapterError(
      "anthropic",
      "invalid-response",
      "The user-session runtime returned a malformed response.",
      { retryable: false, diagnostics: [{ code: "malformed_runtime_response", path: "stdout" }] },
    );
  }
  return {
    output: structuredOutput<Output>("anthropic", response.structured_output, "structured_output"),
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    sessionId: response.session_id,
  };
}

export class AnthropicClaudeUserSessionAdapter<
  Input extends JsonValue = JsonValue,
  Output extends JsonValue = JsonValue,
> {
  readonly provider = "anthropic" as const;
  private readonly options: Required<
    Pick<UserSessionAdapterOptions, "command" | "maxOutputBytes" | "runner" | "timeoutMs">
  > &
    Pick<UserSessionAdapterOptions, "configuredModel" | "environment">;

  constructor(options: UserSessionAdapterOptions) {
    this.options = {
      ...options,
      runner: options.runner ?? runUserSessionProcess,
      command: options.command ?? "claude",
      timeoutMs: resolveUserSessionTimeout(this.provider, options.timeoutMs),
      maxOutputBytes: options.maxOutputBytes ?? defaultMaxOutputBytes,
    };
  }

  async execute(request: ModelRequest<Input>): Promise<ModelResponse<Output>> {
    assertExactModel(this.provider, this.options.configuredModel, request.model);
    assertDataExposureAllowed(this.provider, request.dataPolicy);
    const maxOutputTokens = resolveOutputTokenLimit(this.provider, request.maxOutputTokens);
    const startTime = Date.now();
    request.onProgress?.({ stage: "started", elapsedMs: 0 });

    try {
      return await withPrivateTemporaryDirectory(async (directory) => {
        const args = [
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
          request.model.modelId,
          "--system-prompt",
          request.systemPrompt,
          "--output-format",
          "json",
          "--json-schema",
          JSON.stringify(request.outputSchema),
        ];
        const environment = sanitizedEnvironment(
          this.options.environment ?? process.env,
          anthropicSecretEnvironmentNames,
        );
        const result = await this.options.runner(this.options.command, args, {
          cwd: directory,
          env: {
            ...environment,
            CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(maxOutputTokens),
            CLAUDE_CODE_MAX_RETRIES: "0",
            MAX_STRUCTURED_OUTPUT_RETRIES: "0",
          },
          stdin: JSON.stringify(request.input),
          timeoutMs: this.options.timeoutMs,
          maxOutputBytes: this.options.maxOutputBytes,
          ...(request.signal === undefined ? {} : { signal: request.signal }),
        });
        assertBoundedResult(this.provider, result, this.options.maxOutputBytes);
        resultOrError(this.provider, result);
        const parsed = parseClaudeResult<Output>(result.stdout);
        assertOutputWithinLimit(this.provider, parsed.outputTokens, maxOutputTokens);
        const totalTokens = parsed.inputTokens + parsed.outputTokens;
        request.onProgress?.({
          stage: "completed",
          elapsedMs: Date.now() - startTime,
          tokensObserved: totalTokens,
        });
        return {
          output: parsed.output,
          contextSnapshotId: request.contextSnapshotId,
          provider: this.provider,
          company: this.provider,
          modelId: request.model.modelId,
          providerRequestId: parsed.sessionId,
          structuredOutputSha256: responseHash(parsed.output),
          usage: {
            inputTokens: parsed.inputTokens,
            outputTokens: parsed.outputTokens,
            totalTokens,
          },
          cost: { estimatedUsd: null },
        };
      });
    } catch (error) {
      throw normalizeProcessError(this.provider, error);
    }
  }
}

const permittedCodexEventTypes = new Set([
  "thread.started",
  "turn.started",
  "item.started",
  "item.updated",
  "item.completed",
  "turn.completed",
]);

// Codex may report passive reasoning and todo-list lifecycle events before the
// final message. Accept them so normal generation can complete, but deliberately
// discard all passive item content. Tool-bearing, mutation, search, error, and
// unknown event/item types remain prohibited.
const permittedCodexItemTypes = new Set(["agent_message", "reasoning", "todo_list"]);

function parseCodexEvents(text: string): {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly threadId: string;
} {
  const lines = text.split(/\r?\n/u).filter((line) => line.trim() !== "");
  if (lines.length === 0) {
    throw new ProviderAdapterError(
      "openai",
      "invalid-response",
      "The user-session runtime returned no events.",
      {
        retryable: false,
        diagnostics: [{ code: "missing_events", path: "stdout" }],
      },
    );
  }
  let threadId: string | undefined;
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  for (const [index, line] of lines.entries()) {
    const event = parseJson<JsonValue>("openai", line, `stdout.${index}`) as {
      readonly type?: unknown;
      readonly thread_id?: unknown;
      readonly item?: unknown;
      readonly usage?: unknown;
    };
    if (typeof event.type !== "string") {
      throw new ProviderAdapterError(
        "openai",
        "invalid-response",
        "The user-session runtime returned a malformed event.",
        { retryable: false, diagnostics: [{ code: "malformed_event", path: `stdout.${index}` }] },
      );
    }
    if (!permittedCodexEventTypes.has(event.type)) {
      throw new ProviderAdapterError(
        "openai",
        "invalid-response",
        "The user-session runtime reported a prohibited event.",
        { retryable: false, diagnostics: [{ code: "prohibited_event", path: `stdout.${index}` }] },
      );
    }
    if (event.type === "thread.started") {
      if (typeof event.thread_id !== "string" || event.thread_id.trim() === "") {
        throw new ProviderAdapterError(
          "openai",
          "invalid-response",
          "The user-session runtime returned a malformed thread event.",
          { retryable: false },
        );
      }
      threadId = event.thread_id;
    }
    if (
      event.type === "item.started" ||
      event.type === "item.updated" ||
      event.type === "item.completed"
    ) {
      const item = event.item as { readonly type?: unknown } | undefined;
      if (typeof item?.type !== "string" || !permittedCodexItemTypes.has(item.type)) {
        throw new ProviderAdapterError(
          "openai",
          "invalid-response",
          "The user-session runtime reported a prohibited item.",
          {
            retryable: false,
            diagnostics: [{ code: "prohibited_item", path: `stdout.${index}.item` }],
          },
        );
      }
    }
    if (event.type === "turn.completed") {
      const eventUsage = event.usage as
        | { readonly input_tokens?: unknown; readonly output_tokens?: unknown }
        | undefined;
      if (
        !validTokenCount(eventUsage?.input_tokens) ||
        !validTokenCount(eventUsage.output_tokens)
      ) {
        throw new ProviderAdapterError(
          "openai",
          "invalid-response",
          "The user-session runtime returned malformed usage.",
          {
            retryable: false,
            diagnostics: [{ code: "malformed_usage", path: `stdout.${index}.usage` }],
          },
        );
      }
      inputTokens = eventUsage.input_tokens;
      outputTokens = eventUsage.output_tokens;
    }
  }
  if (threadId === undefined || inputTokens === undefined || outputTokens === undefined) {
    throw new ProviderAdapterError(
      "openai",
      "invalid-response",
      "The user-session runtime returned an incomplete event stream.",
      { retryable: false, diagnostics: [{ code: "incomplete_events", path: "stdout" }] },
    );
  }
  return { inputTokens, outputTokens, threadId };
}

const codexConfigurationOverrides = [
  'approval_policy="never"',
  "features.shell_tool=false",
  "features.unified_exec=false",
  "features.multi_agent=false",
  "features.apps=false",
  "features.browser_use=false",
  "features.computer_use=false",
  "features.goals=false",
  "features.hooks=false",
  "features.image_generation=false",
  "apps._default.enabled=false",
  'web_search="disabled"',
] as const;

const codexCriticConfigurationOverrides = ['model_reasoning_effort="low"'] as const;

export class OpenAICodexUserSessionAdapter<
  Input extends JsonValue = JsonValue,
  Output extends JsonValue = JsonValue,
> {
  readonly provider = "openai" as const;
  private readonly options: Required<
    Pick<UserSessionAdapterOptions, "command" | "maxOutputBytes" | "runner" | "timeoutMs">
  > &
    Pick<UserSessionAdapterOptions, "configuredModel" | "environment">;

  constructor(options: UserSessionAdapterOptions) {
    this.options = {
      ...options,
      runner: options.runner ?? runUserSessionProcess,
      command: options.command ?? "codex",
      timeoutMs: resolveUserSessionTimeout(this.provider, options.timeoutMs),
      maxOutputBytes: options.maxOutputBytes ?? defaultMaxOutputBytes,
    };
  }

  async execute(request: ModelRequest<Input>): Promise<ModelResponse<Output>> {
    assertExactModel(this.provider, this.options.configuredModel, request.model);
    assertDataExposureAllowed(this.provider, request.dataPolicy);
    const maxOutputTokens = resolveOutputTokenLimit(this.provider, request.maxOutputTokens);
    const startTime = Date.now();
    request.onProgress?.({ stage: "started", elapsedMs: 0 });

    try {
      return await withPrivateTemporaryDirectory(async (directory) => {
        const schemaPath = join(directory, "output-schema.json");
        const finalPath = join(directory, "final-output.json");
        await writeFile(schemaPath, JSON.stringify(request.outputSchema), { mode: 0o600 });
        await writeFile(finalPath, "", { mode: 0o600 });
        const args = [
          "exec",
          "-",
          "--json",
          "--output-schema",
          schemaPath,
          "--output-last-message",
          finalPath,
          "--ephemeral",
          "--ignore-user-config",
          "--ignore-rules",
          "--skip-git-repo-check",
          "--cd",
          directory,
          "--model",
          request.model.modelId,
          "--sandbox",
          "read-only",
          "--strict-config",
          ...(request.model.role === "critic"
            ? codexCriticConfigurationOverrides.flatMap((override) => ["--config", override])
            : []),
          ...codexConfigurationOverrides.flatMap((override) => ["--config", override]),
        ];
        const result = await this.options.runner(this.options.command, args, {
          cwd: directory,
          env: sanitizedEnvironment(
            this.options.environment ?? process.env,
            openAISecretEnvironmentNames,
          ),
          stdin: `System instructions:\n${request.systemPrompt}\n\nInput JSON:\n${JSON.stringify(request.input)}`,
          timeoutMs: this.options.timeoutMs,
          maxOutputBytes: this.options.maxOutputBytes,
          ...(request.signal === undefined ? {} : { signal: request.signal }),
        });
        assertBoundedResult(this.provider, result, this.options.maxOutputBytes);
        resultOrError(this.provider, result);
        const events = parseCodexEvents(result.stdout);
        const output = parseJson<Output>(
          this.provider,
          await readFile(finalPath, { encoding: "utf8" }),
          "output-last-message",
        );
        // Codex CLI currently exposes no pre-generation output-token cap. Enforce the
        // caller's budget from the observed usage and reject an oversized response.
        assertOutputWithinLimit(this.provider, events.outputTokens, maxOutputTokens);
        const totalTokens = events.inputTokens + events.outputTokens;
        request.onProgress?.({
          stage: "completed",
          elapsedMs: Date.now() - startTime,
          tokensObserved: totalTokens,
        });
        return {
          output,
          contextSnapshotId: request.contextSnapshotId,
          provider: this.provider,
          company: this.provider,
          modelId: request.model.modelId,
          providerRequestId: events.threadId,
          structuredOutputSha256: responseHash(output),
          usage: {
            inputTokens: events.inputTokens,
            outputTokens: events.outputTokens,
            totalTokens,
          },
          cost: { estimatedUsd: null },
        };
      });
    } catch (error) {
      throw normalizeProcessError(this.provider, error);
    }
  }
}

async function probeUserSession(
  args: readonly string[],
  secretNames: readonly string[],
  defaults: { readonly command: string; readonly options: UserSessionProbeOptions },
): Promise<UserSessionLoginStatus> {
  const runner = defaults.options.runner ?? runUserSessionProcess;
  try {
    return await withPrivateTemporaryDirectory(async (directory) => {
      const result = await runner(defaults.options.command ?? defaults.command, args, {
        cwd: directory,
        env: sanitizedEnvironment(defaults.options.environment ?? process.env, secretNames),
        stdin: "",
        timeoutMs: defaults.options.timeoutMs ?? 10_000,
        maxOutputBytes: defaults.options.maxOutputBytes ?? 65_536,
      });
      return { available: true, authenticated: result.exitCode === 0 };
    });
  } catch (error) {
    if (error instanceof UserSessionProcessError && error.reason === "missing-runtime") {
      return { available: false, authenticated: false };
    }
    return { available: true, authenticated: false };
  }
}

export function probeAnthropicClaudeUserSession(
  options: UserSessionProbeOptions = {},
): Promise<UserSessionLoginStatus> {
  return probeUserSession(["auth", "status", "--json"], anthropicSecretEnvironmentNames, {
    command: "claude",
    options,
  });
}

export function probeOpenAICodexUserSession(
  options: UserSessionProbeOptions = {},
): Promise<UserSessionLoginStatus> {
  return probeUserSession(["login", "status"], openAISecretEnvironmentNames, {
    command: "codex",
    options,
  });
}
