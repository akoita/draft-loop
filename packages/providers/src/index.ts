import { createHash } from "node:crypto";
import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages/messages.js";
import type { AgentRole, ModelCompany, ModelSelection } from "@draft-loop/domain";
import type { ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses.js";

export * from "./user-session.js";

export type ProviderId = ModelCompany;
export type { AgentRole, ModelSelection };

/**
 * Whether two selections are served by different provider companies.
 *
 * This is a data-exposure question — who receives candidate material — and it
 * is deliberately not the independent-review check. Independence is decided by
 * model lineage in `@draft-loop/domain`'s `hasIndependentReview`; comparing
 * companies both refuses two models from one company and accepts two vendors
 * serving one set of weights. Do not reuse this as an independence gate.
 */
export function usesDifferentProviders(author: ModelSelection, critic: ModelSelection): boolean {
  return author.company.trim() !== critic.company.trim();
}

export type JsonPrimitive = boolean | null | number | string;
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];
export type JsonObject = { readonly [key: string]: JsonValue };
export type JsonSchema = JsonObject;

export interface DataExposurePolicy {
  /** Explicit user approval for transmitting this request to a model provider. */
  readonly allowTransmission: boolean;
  /** The provider companies approved for this request. */
  readonly allowedCompanies: readonly ProviderId[];
  /** Whether the request contains candidate or other sensitive material. */
  readonly sensitiveData: boolean;
  /** Explicit acknowledgement for sending sensitive material to a provider. */
  readonly sensitiveDataAcknowledged: boolean;
  /** A requested retention preference; provider retention is never assumed. */
  readonly requestedRetention?: "ephemeral-request" | "provider-default";
}

export interface RetryOptions {
  readonly maxRetries?: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface StreamingProgressEvent {
  readonly stage: "started" | "streaming" | "completed";
  readonly elapsedMs: number;
  readonly tokensObserved?: number;
}

export type StreamingProgressCallback = (event: StreamingProgressEvent) => void;

export interface ModelRequest<Input extends JsonValue = JsonValue> {
  readonly contextSnapshotId: string;
  readonly model: ModelSelection;
  readonly systemPrompt: string;
  readonly input: Input;
  readonly outputSchema: JsonSchema;
  readonly outputName: string;
  /** Maximum number of output tokens the provider may generate. */
  readonly maxOutputTokens?: number;
  readonly dataPolicy: DataExposurePolicy;
  readonly onProgress?: StreamingProgressCallback;
  readonly signal?: AbortSignal;
}

const defaultMaxOutputTokens = 4096;
const maximumMaxOutputTokens = 32_768;

function resolveMaxOutputTokens(provider: ProviderId, value: number | undefined): number {
  const resolved = value ?? defaultMaxOutputTokens;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > maximumMaxOutputTokens) {
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
  return resolved;
}

export interface ModelCost {
  readonly estimatedUsd: number | null;
}

export interface ModelUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
}

export interface ModelResponse<Output extends JsonValue = JsonValue> {
  readonly output: Output;
  readonly contextSnapshotId: string;
  readonly provider: ProviderId;
  readonly company: ProviderId;
  readonly modelId: string;
  readonly providerRequestId: string | null;
  readonly structuredOutputSha256: string;
  readonly usage: ModelUsage;
  readonly cost: ModelCost;
}

export interface ModelPricing {
  readonly inputUsdPerMillionTokens: number;
  readonly outputUsdPerMillionTokens: number;
}

export type ProviderErrorCode =
  | "authentication"
  | "permission"
  | "rate-limit"
  | "quota-exhausted"
  | "timeout"
  | "cancelled"
  | "transient"
  | "invalid-request"
  | "invalid-response"
  | "policy"
  | "unknown";

export const providerFailureStages = [
  "transport-parsing",
  "response-schema-validation",
  "artifact-schema-validation",
  "factual-invariant-rejection",
] as const;

export type ProviderFailureStage = (typeof providerFailureStages)[number];

export interface ProviderErrorMetadata {
  readonly status?: number;
  readonly requestId?: string;
  readonly retryAfterMs?: number;
  readonly failureStage?: ProviderFailureStage;
  readonly diagnostics?: readonly ProviderValidationDiagnostic[];
}

export interface ProviderValidationDiagnostic {
  readonly code: string;
  readonly path: string;
}

export class ProviderAdapterError extends Error {
  readonly code: ProviderErrorCode;
  readonly provider: ProviderId;
  readonly retryable: boolean;
  readonly status: number | null;
  readonly requestId: string | null;
  readonly retryAfterMs: number | null;
  readonly failureStage: ProviderFailureStage | null;
  readonly diagnostics: readonly ProviderValidationDiagnostic[];
  readonly metadata: ProviderErrorMetadata;

  constructor(
    provider: ProviderId,
    code: ProviderErrorCode,
    message: string,
    options: {
      readonly retryable?: boolean;
      readonly status?: number;
      readonly requestId?: string;
      readonly retryAfterMs?: number;
      readonly failureStage?: ProviderFailureStage;
      readonly diagnostics?: readonly ProviderValidationDiagnostic[];
    } = {},
  ) {
    super(message);
    this.name = "ProviderAdapterError";
    this.code = code;
    this.provider = provider;
    this.retryable = options.retryable ?? isRetryable(code);
    this.status = options.status ?? null;
    this.requestId = options.requestId ?? null;
    this.retryAfterMs = sanitizeRetryAfterMs(options.retryAfterMs) ?? null;
    this.failureStage = options.failureStage ?? null;
    this.diagnostics = options.diagnostics ?? [];
    this.metadata = {
      ...(options.status === undefined ? {} : { status: options.status }),
      ...(options.requestId === undefined ? {} : { requestId: options.requestId }),
      ...(this.retryAfterMs === null ? {} : { retryAfterMs: this.retryAfterMs }),
      ...(this.failureStage === null ? {} : { failureStage: this.failureStage }),
      ...(options.diagnostics === undefined ? {} : { diagnostics: options.diagnostics }),
    };
  }
}

function isRetryable(code: ProviderErrorCode): boolean {
  return code === "rate-limit" || code === "timeout" || code === "transient";
}

const maxRetryAfterMs = 60_000;

function sanitizeRetryAfterMs(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  return Math.min(maxRetryAfterMs, Math.round(value));
}

export function assertDataExposureAllowed(provider: ProviderId, policy: DataExposurePolicy): void {
  if (!policy.allowTransmission) {
    throw new ProviderAdapterError(
      provider,
      "policy",
      "Provider transmission is not approved for this request.",
      { retryable: false },
    );
  }

  if (!policy.allowedCompanies.some((company) => company.trim() === provider.trim())) {
    throw new ProviderAdapterError(
      provider,
      "policy",
      "The provider is not allowlisted for this request.",
      { retryable: false },
    );
  }

  if (policy.sensitiveData && !policy.sensitiveDataAcknowledged) {
    throw new ProviderAdapterError(
      provider,
      "policy",
      "Sensitive data transmission requires explicit user acknowledgement.",
      { retryable: false },
    );
  }
}

interface ProviderErrorLike {
  readonly status?: unknown;
  readonly statusCode?: unknown;
  readonly code?: unknown;
  readonly name?: unknown;
  readonly message?: unknown;
  readonly requestID?: unknown;
  readonly request_id?: unknown;
  readonly _request_id?: unknown;
  readonly headers?: unknown;
  readonly error?: unknown;
}

function errorLike(value: unknown): ProviderErrorLike {
  return typeof value === "object" && value !== null ? (value as ProviderErrorLike) : {};
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function headerValue(headers: unknown, name: string): string | undefined {
  if (typeof headers !== "object" || headers === null) return undefined;
  const candidate = headers as {
    readonly get?: (headerName: string) => unknown;
    readonly [key: string]: unknown;
  };
  if (typeof candidate.get === "function") {
    try {
      const value = candidate.get(name);
      if (typeof value === "string") return value;
    } catch {
      return undefined;
    }
  }
  for (const [key, value] of Object.entries(candidate)) {
    if (key.toLowerCase() !== name.toLowerCase()) continue;
    return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
  }
  return undefined;
}

function parseRetryAfterMs(details: ProviderErrorLike): number | undefined {
  const retryAfterMs = headerValue(details.headers, "retry-after-ms");
  if (retryAfterMs !== undefined) {
    const numeric = Number(retryAfterMs.trim());
    const sanitized = sanitizeRetryAfterMs(numeric);
    if (sanitized !== undefined) return sanitized;
  }

  const retryAfter = headerValue(details.headers, "retry-after");
  if (retryAfter === undefined) return undefined;
  const numeric = Number(retryAfter.trim());
  if (Number.isFinite(numeric) && numeric >= 0) {
    return sanitizeRetryAfterMs(numeric * 1_000);
  }
  const timestamp = Date.parse(retryAfter);
  if (!Number.isFinite(timestamp)) return undefined;
  return sanitizeRetryAfterMs(timestamp - Date.now());
}

export function normalizeProviderError(provider: ProviderId, error: unknown): ProviderAdapterError {
  if (error instanceof ProviderAdapterError) {
    return error;
  }

  const details = errorLike(error);
  const nested = errorLike(details.error);
  const status = finiteNumber(details.status ?? details.statusCode);
  const requestId =
    nonEmptyString(details.requestID) ??
    nonEmptyString(details.request_id) ??
    nonEmptyString(details._request_id);
  const combined = [
    details.code,
    details.name,
    details.message,
    nested.code,
    nested.name,
    nested.message,
    nested.error,
  ]
    .map(nonEmptyString)
    .filter((value): value is string => value !== undefined)
    .join(" ")
    .toLowerCase();

  let code: ProviderErrorCode = "unknown";
  if (
    combined.includes("aborterror") ||
    combined.includes("abort_err") ||
    combined.includes("err_canceled") ||
    combined.includes("cancelled") ||
    combined.includes("canceled") ||
    combined.includes("aborted")
  ) {
    code = "cancelled";
  } else if (
    provider === "openai" &&
    (combined.includes("insufficient_quota") ||
      combined.includes("insufficient quota") ||
      combined.includes("quota exceeded") ||
      combined.includes("quota exhausted") ||
      combined.includes("quota_exhausted"))
  ) {
    code = "quota-exhausted";
  } else if (
    status === 401 ||
    combined.includes("authentication") ||
    combined.includes("unauthorized")
  ) {
    code = "authentication";
  } else if (status === 403 || combined.includes("permission") || combined.includes("forbidden")) {
    code = "permission";
  } else if (
    status === 429 ||
    combined.includes("rate limit") ||
    combined.includes("rate_limit") ||
    combined.includes("too many requests")
  ) {
    code = "rate-limit";
  } else if (status === 408 || combined.includes("timeout") || combined.includes("timed out")) {
    code = "timeout";
  } else if (status !== undefined && status >= 500) {
    code = "transient";
  } else if (status === 400 || status === 422 || combined.includes("invalid request")) {
    code = "invalid-request";
  }

  const message =
    code === "unknown" ? "The provider request failed." : `The provider request failed (${code}).`;
  const retryAfterMs = parseRetryAfterMs(details);
  return new ProviderAdapterError(provider, code, message, {
    ...(status === undefined ? {} : { status }),
    ...(requestId === undefined ? {} : { requestId }),
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  });
}

function serializeJson(value: JsonValue): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new ProviderAdapterError(
      "unknown",
      "invalid-request",
      "The request input is not JSON serializable.",
    );
  }
  return serialized;
}

function hashStructuredOutput(value: JsonValue): string {
  return createHash("sha256").update(serializeJson(value), "utf8").digest("hex");
}

function parseJson<Output extends JsonValue>(
  provider: ProviderId,
  text: unknown,
  outputPath = "output",
): Output {
  if (typeof text !== "string" || text.trim() === "") {
    throw new ProviderAdapterError(
      provider,
      "invalid-response",
      "The provider returned no structured output.",
      {
        retryable: false,
        failureStage: "transport-parsing",
        diagnostics: [{ code: "missing_output", path: outputPath }],
      },
    );
  }

  try {
    return JSON.parse(text) as Output;
  } catch {
    throw new ProviderAdapterError(
      provider,
      "invalid-response",
      "The provider returned invalid JSON output.",
      {
        retryable: false,
        failureStage: "transport-parsing",
        diagnostics: [{ code: "invalid_json", path: outputPath }],
      },
    );
  }
}

function modelMatches(expected: ModelSelection, actual: ModelSelection): boolean {
  return (
    expected.company.trim() === actual.company.trim() &&
    expected.modelId === actual.modelId &&
    expected.role === actual.role &&
    expected.promptTemplateVersion === actual.promptTemplateVersion
  );
}

function assertConfiguredModel(
  provider: ProviderId,
  configuredModel: ModelSelection,
  requestModel: ModelSelection,
): void {
  if (configuredModel.company.trim() !== provider || !modelMatches(configuredModel, requestModel)) {
    throw new ProviderAdapterError(
      provider,
      "invalid-request",
      "The request model does not match the exact configured provider model.",
      { retryable: false },
    );
  }
}

function cost(
  pricing: ModelPricing | undefined,
  inputTokens: number,
  outputTokens: number,
): ModelCost {
  return {
    estimatedUsd: pricing
      ? (inputTokens * pricing.inputUsdPerMillionTokens +
          outputTokens * pricing.outputUsdPerMillionTokens) /
        1_000_000
      : null,
  };
}

function usage(
  inputTokens: number,
  outputTokens: number,
  pricing: ModelPricing | undefined,
): { readonly usage: ModelUsage; readonly cost: ModelCost } {
  return {
    usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
    cost: cost(pricing, inputTokens, outputTokens),
  };
}

type AnthropicResponse = {
  readonly data: unknown;
  readonly request_id?: string | null;
};

type AnthropicMessagePromise = PromiseLike<unknown> & {
  readonly withResponse?: () => Promise<AnthropicResponse>;
};

export interface AnthropicClient {
  readonly messages: {
    create(
      parameters: MessageCreateParamsNonStreaming,
      options?: { readonly signal?: AbortSignal },
    ): AnthropicMessagePromise;
  };
}

export interface ProviderAdapterOptions {
  readonly configuredModel: ModelSelection;
  readonly pricing?: ModelPricing;
  readonly retry?: RetryOptions;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function executeWithRetry<T>(
  action: () => Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  const maxRetries = options?.maxRetries ?? 3;
  const baseDelayMs = options?.baseDelayMs ?? 200;
  const maxDelayMs = options?.maxDelayMs ?? 5000;
  const sleep = options?.sleep ?? defaultSleep;

  let attempt = 0;
  while (true) {
    try {
      return await action();
    } catch (error) {
      const isRetryableError = error instanceof ProviderAdapterError ? error.retryable : false;

      if (!isRetryableError || attempt >= maxRetries) {
        throw error;
      }

      attempt += 1;
      const exponential = baseDelayMs * 2 ** (attempt - 1);
      const jitter = Math.random() * (baseDelayMs / 2);
      const providerDelay = error instanceof ProviderAdapterError ? error.retryAfterMs : null;
      // Do not retry earlier than the provider requested. Long waits are
      // returned to the durable orchestration/UI layer instead of hiding an
      // unresponsive sleep inside one adapter call.
      if (providerDelay !== null && providerDelay > maxDelayMs) {
        throw error;
      }
      const delay = Math.min(maxDelayMs, providerDelay ?? exponential + jitter);
      await sleep(delay);
    }
  }
}

function anthropicMessageData(value: unknown): {
  readonly content: readonly { readonly type: string; readonly text?: string }[];
  readonly stop_reason: unknown;
  readonly usage: { readonly input_tokens: number; readonly output_tokens: number };
} {
  if (typeof value !== "object" || value === null) {
    throw new ProviderAdapterError(
      "anthropic",
      "invalid-response",
      "The provider response was malformed.",
    );
  }
  const response = value as {
    readonly content?: unknown;
    readonly stop_reason?: unknown;
    readonly usage?: unknown;
  };
  if (
    !Array.isArray(response.content) ||
    typeof response.usage !== "object" ||
    response.usage === null
  ) {
    throw new ProviderAdapterError(
      "anthropic",
      "invalid-response",
      "The provider response was malformed.",
    );
  }
  const content = response.content.filter(
    (block): block is { readonly type: string; readonly text?: string } =>
      typeof block === "object" &&
      block !== null &&
      "type" in block &&
      typeof block.type === "string",
  );
  const usageValue = response.usage as {
    readonly input_tokens?: unknown;
    readonly output_tokens?: unknown;
  };
  if (
    content.length !== response.content.length ||
    typeof usageValue.input_tokens !== "number" ||
    typeof usageValue.output_tokens !== "number"
  ) {
    throw new ProviderAdapterError(
      "anthropic",
      "invalid-response",
      "The provider response was malformed.",
    );
  }
  return {
    content,
    stop_reason: response.stop_reason,
    usage: { input_tokens: usageValue.input_tokens, output_tokens: usageValue.output_tokens },
  };
}

function anthropicStopReasonError(stopReason: unknown): ProviderAdapterError {
  const code =
    stopReason === "max_tokens" ||
    stopReason === "refusal" ||
    stopReason === "pause_turn" ||
    stopReason === "model_context_window_exceeded"
      ? stopReason
      : "unexpected_stop_reason";
  return new ProviderAdapterError(
    "anthropic",
    "invalid-response",
    "The provider did not complete the structured response.",
    {
      retryable: false,
      diagnostics: [{ code, path: "stop_reason" }],
    },
  );
}

export class AnthropicAdapter<
  Input extends JsonValue = JsonValue,
  Output extends JsonValue = JsonValue,
> {
  readonly provider = "anthropic" as const;
  private readonly client: AnthropicClient;
  private readonly configuredModel: ModelSelection;
  private readonly pricing: ModelPricing | undefined;
  private readonly retry: RetryOptions | undefined;

  constructor(client: AnthropicClient, options: ProviderAdapterOptions) {
    this.client = client;
    this.configuredModel = options.configuredModel;
    this.pricing = options.pricing;
    this.retry = options.retry;
  }

  async execute(request: ModelRequest<Input>): Promise<ModelResponse<Output>> {
    assertConfiguredModel(this.provider, this.configuredModel, request.model);
    assertDataExposureAllowed(this.provider, request.dataPolicy);
    const maxOutputTokens = resolveMaxOutputTokens(this.provider, request.maxOutputTokens);

    const startTime = Date.now();
    request.onProgress?.({ stage: "started", elapsedMs: 0 });

    const parameters: MessageCreateParamsNonStreaming = {
      model: request.model.modelId,
      max_tokens: maxOutputTokens,
      system: request.systemPrompt,
      messages: [{ role: "user", content: serializeJson(request.input) }],
      output_config: {
        format: { type: "json_schema", schema: request.outputSchema },
      },
    };

    return executeWithRetry(async () => {
      try {
        const responsePromise = this.client.messages.create(
          parameters,
          ...(request.signal === undefined ? [] : [{ signal: request.signal }]),
        );
        const response =
          typeof responsePromise.withResponse === "function"
            ? await responsePromise.withResponse()
            : { data: await responsePromise, request_id: null };
        const message = anthropicMessageData(response.data);
        if (message.stop_reason !== "end_turn") {
          throw anthropicStopReasonError(message.stop_reason);
        }
        const textBlock = message.content.find((block) => block.type === "text");
        if (typeof textBlock?.text !== "string" || textBlock.text.trim() === "") {
          throw new ProviderAdapterError(
            this.provider,
            "invalid-response",
            "The provider returned no structured text output.",
            {
              retryable: false,
              diagnostics: [{ code: "missing_text", path: "content" }],
            },
          );
        }
        const output = parseJson<Output>(this.provider, textBlock.text, "content");
        const accounting = usage(
          message.usage.input_tokens,
          message.usage.output_tokens,
          this.pricing,
        );
        const elapsedMs = Date.now() - startTime;
        request.onProgress?.({
          stage: "completed",
          elapsedMs,
          tokensObserved: accounting.usage.totalTokens,
        });
        return {
          output,
          contextSnapshotId: request.contextSnapshotId,
          provider: this.provider,
          company: this.provider,
          modelId: request.model.modelId,
          providerRequestId: response.request_id ?? null,
          structuredOutputSha256: hashStructuredOutput(output),
          ...accounting,
        };
      } catch (error) {
        throw normalizeProviderError(this.provider, error);
      }
    }, this.retry);
  }
}

type OpenAIResponse = OpenAIResponseType & { readonly _request_id?: string | null };
type OpenAIResponseType = import("openai/resources/responses/responses.js").Response;

export interface OpenAIClient {
  readonly responses: {
    create(
      parameters: ResponseCreateParamsNonStreaming,
      options?: { readonly signal?: AbortSignal },
    ): PromiseLike<OpenAIResponse>;
  };
}

export class OpenAIAdapter<
  Input extends JsonValue = JsonValue,
  Output extends JsonValue = JsonValue,
> {
  readonly provider = "openai" as const;
  private readonly client: OpenAIClient;
  private readonly configuredModel: ModelSelection;
  private readonly pricing: ModelPricing | undefined;
  private readonly retry: RetryOptions | undefined;

  constructor(client: OpenAIClient, options: ProviderAdapterOptions) {
    this.client = client;
    this.configuredModel = options.configuredModel;
    this.pricing = options.pricing;
    this.retry = options.retry;
  }

  async execute(request: ModelRequest<Input>): Promise<ModelResponse<Output>> {
    assertConfiguredModel(this.provider, this.configuredModel, request.model);
    assertDataExposureAllowed(this.provider, request.dataPolicy);
    const maxOutputTokens = resolveMaxOutputTokens(this.provider, request.maxOutputTokens);

    const startTime = Date.now();
    request.onProgress?.({ stage: "started", elapsedMs: 0 });

    const parameters: ResponseCreateParamsNonStreaming = {
      model: request.model.modelId,
      max_output_tokens: maxOutputTokens,
      instructions: request.systemPrompt,
      input: [
        {
          role: "user",
          content: [{ type: "input_text", text: serializeJson(request.input) }],
        },
      ],
      store: false,
      text: {
        format: {
          type: "json_schema",
          name: request.outputName,
          schema: request.outputSchema,
          strict: true,
        },
      },
    };

    return executeWithRetry(async () => {
      try {
        const response = await this.client.responses.create(
          parameters,
          ...(request.signal === undefined ? [] : [{ signal: request.signal }]),
        );
        const output = parseJson<Output>(this.provider, response.output_text, "output_text");
        const inputTokens = response.usage?.input_tokens ?? 0;
        const outputTokens = response.usage?.output_tokens ?? 0;
        const accounting = usage(inputTokens, outputTokens, this.pricing);
        const elapsedMs = Date.now() - startTime;
        request.onProgress?.({
          stage: "completed",
          elapsedMs,
          tokensObserved: accounting.usage.totalTokens,
        });
        return {
          output,
          contextSnapshotId: request.contextSnapshotId,
          provider: this.provider,
          company: this.provider,
          modelId: request.model.modelId,
          providerRequestId: response._request_id ?? null,
          structuredOutputSha256: hashStructuredOutput(output),
          ...accounting,
        };
      } catch (error) {
        throw normalizeProviderError(this.provider, error);
      }
    }, this.retry);
  }
}

export function createAnthropicAdapter<
  Input extends JsonValue = JsonValue,
  Output extends JsonValue = JsonValue,
>(client: AnthropicClient, options: ProviderAdapterOptions): AnthropicAdapter<Input, Output> {
  return new AnthropicAdapter<Input, Output>(client, options);
}

export function createOpenAIAdapter<
  Input extends JsonValue = JsonValue,
  Output extends JsonValue = JsonValue,
>(client: OpenAIClient, options: ProviderAdapterOptions): OpenAIAdapter<Input, Output> {
  return new OpenAIAdapter<Input, Output>(client, options);
}

export interface LocalClient {
  readonly endpoint?: string;
  readonly fetch?: typeof fetch;
}

export class LocalModelAdapter<
  Input extends JsonValue = JsonValue,
  Output extends JsonValue = JsonValue,
> {
  readonly provider = "local" as const;
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;
  private readonly configuredModel: ModelSelection;
  private readonly pricing: ModelPricing | undefined;
  private readonly retry: RetryOptions | undefined;

  constructor(client: LocalClient = {}, options: ProviderAdapterOptions) {
    this.endpoint = client.endpoint ?? "http://127.0.0.1:11434/v1";
    this.fetchImpl = client.fetch ?? globalThis.fetch;
    this.configuredModel = options.configuredModel;
    this.pricing = options.pricing;
    this.retry = options.retry;
  }

  async execute(request: ModelRequest<Input>): Promise<ModelResponse<Output>> {
    assertConfiguredModel(this.provider, this.configuredModel, request.model);
    assertDataExposureAllowed(this.provider, request.dataPolicy);
    const maxOutputTokens = resolveMaxOutputTokens(this.provider, request.maxOutputTokens);

    const startTime = Date.now();
    request.onProgress?.({ stage: "started", elapsedMs: 0 });

    const payload = {
      model: request.model.modelId,
      max_tokens: maxOutputTokens,
      messages: [
        { role: "system", content: request.systemPrompt },
        { role: "user", content: serializeJson(request.input) },
      ],
      response_format: {
        type: "json_object",
      },
      temperature: 0.1,
    };

    return executeWithRetry(async () => {
      try {
        const url = `${this.endpoint.replace(/\/+$/u, "")}/chat/completions`;
        const res = await this.fetchImpl(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
          ...(request.signal === undefined ? {} : { signal: request.signal }),
        });

        if (!res.ok) {
          const status = res.status;
          const retryAfterMs = parseRetryAfterMs({ headers: res.headers });
          throw new ProviderAdapterError(
            this.provider,
            status >= 500 ? "transient" : status === 429 ? "rate-limit" : "invalid-request",
            `Local model server returned status ${status}`,
            { status, ...(retryAfterMs === undefined ? {} : { retryAfterMs }) },
          );
        }

        const data = (await res.json()) as {
          readonly id?: string;
          readonly choices?: readonly {
            readonly message?: { readonly content?: string };
          }[];
          readonly usage?: {
            readonly prompt_tokens?: number;
            readonly completion_tokens?: number;
            readonly total_tokens?: number;
          };
        };

        const content = data.choices?.[0]?.message?.content ?? "";
        const output = parseJson<Output>(this.provider, content);
        const inputTokens = data.usage?.prompt_tokens ?? 0;
        const outputTokens = data.usage?.completion_tokens ?? 0;
        const accounting = usage(inputTokens, outputTokens, this.pricing);
        const elapsedMs = Date.now() - startTime;

        request.onProgress?.({
          stage: "completed",
          elapsedMs,
          tokensObserved: accounting.usage.totalTokens,
        });

        return {
          output,
          contextSnapshotId: request.contextSnapshotId,
          provider: this.provider,
          company: this.provider,
          modelId: request.model.modelId,
          providerRequestId: data.id ?? null,
          structuredOutputSha256: hashStructuredOutput(output),
          ...accounting,
        };
      } catch (error) {
        throw normalizeProviderError(this.provider, error);
      }
    }, this.retry);
  }
}

export function createLocalModelAdapter<
  Input extends JsonValue = JsonValue,
  Output extends JsonValue = JsonValue,
>(client: LocalClient = {}, options: ProviderAdapterOptions): LocalModelAdapter<Input, Output> {
  return new LocalModelAdapter<Input, Output>(client, options);
}

/**
 * Model discovery: which model ids a configured credential can actually reach.
 *
 * Re-exported here because this package publishes one entry point. Discovery
 * only uses this module's error types inside function bodies, so the cycle is
 * resolved before anything reads it.
 */
export * from "./discovery.js";
