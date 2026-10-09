import { createHash } from "node:crypto";
import type { ModelSelection } from "@draft-loop/domain";
import { modelSelectionSchema } from "@draft-loop/schemas";
import { Mistral } from "@mistralai/mistralai";
import type { RequestOptions } from "@mistralai/mistralai/lib/sdks.js";
import type { ChatCompletionStreamRequest } from "@mistralai/mistralai/models/components";
import { summarizeDeepInfraOutputIssues } from "./deepinfra-output-diagnostics.js";
import {
  assertDataExposureAllowed,
  executeWithRetry,
  type JsonSchema,
  type JsonValue,
  type ModelPricing,
  type ModelRequest,
  type ModelResponse,
  normalizeProviderError,
  ProviderAdapterError,
  type RetryOptions,
} from "./index.js";
import {
  canceledError,
  cancellableSleep,
  collectMistralStream,
  createMistralStreamWatchdog,
  failResponse,
  isRecord,
} from "./mistral-stream.js";
import { mistralCompany, mistralLarge4ModelId, mistralProvider } from "./model-identities.js";
import { accountOpenAIUsage } from "./openai-usage.js";
import {
  type CompiledOutputSchema,
  compileStructuredOutputSchema,
} from "./structured-output-schema.js";

export { mistralCompany, mistralLarge4ModelId, mistralProvider };

/** The only endpoint host the adapter talks to; no custom base URL is accepted. */
export const mistralBaseUrl = "https://api.mistral.ai";

/** No chunk for this long fails the attempt; steady progress never does. */
const defaultIdleTimeoutMs = 90_000;
/** Generous per-attempt cap for a slow but progressing answer. */
const defaultTotalTimeoutMs = 1_800_000;
const maxSupportedTimeoutMs = 2_147_483_647;
const defaultMaxOutputTokens = 4096;
const maxOutputTokens = 65_536;

type MistralRequestOptions = Pick<RequestOptions, "signal" | "retries" | "timeoutMs">;

/**
 * The only SDK surface the adapter uses; tests and callers inject this narrow shape.
 * `stream` resolves to an async iterable of `{ data: CompletionChunk }` events.
 */
export interface MistralClient {
  readonly chat: {
    stream(
      request: ChatCompletionStreamRequest,
      options?: MistralRequestOptions,
    ): PromiseLike<AsyncIterable<unknown>>;
  };
}

export interface MistralAdapterOptions {
  readonly configuredModel: ModelSelection;
  readonly pricing?: ModelPricing;
  readonly retry?: RetryOptions;
  /** Longest wait without any streamed event before the attempt fails. */
  readonly idleTimeoutMs?: number;
  /** Longest total duration of one attempt, however steadily it progresses. */
  readonly totalTimeoutMs?: number;
}

function invalidRequest(message: string, code: string): ProviderAdapterError {
  return new ProviderAdapterError(mistralProvider, "invalid-request", message, {
    retryable: false,
    diagnostics: [{ code, path: "request" }],
  });
}

function checkedTimeout(value: number | undefined, fallback: number): number {
  const timeout = value ?? fallback;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > maxSupportedTimeoutMs) {
    throw invalidRequest("The Mistral request timeout is invalid.", "invalid_timeout");
  }
  return timeout;
}

function checkedRetryOptions(value: RetryOptions | undefined): RetryOptions {
  const maxRetries = value?.maxRetries ?? 0;
  if (!Number.isSafeInteger(maxRetries) || maxRetries < 0 || maxRetries > 2) {
    throw invalidRequest("The Mistral retry limit is invalid.", "invalid_retry_limit");
  }
  return { ...value, maxRetries };
}

const silentLogger = {
  group: () => undefined,
  groupEnd: () => undefined,
  log: () => undefined,
};

/**
 * Build the fixed Mistral API client.
 *
 * The server URL is pinned so no option can redirect candidate material, and a silent
 * logger replaces the SDK's `MISTRAL_DEBUG` console logger, which would otherwise print
 * request and response bodies. SDK retries are disabled (`strategy: "none"`); DraftLoop
 * retries through `executeWithRetry`.
 */
export function createMistralClient(apiKey: string): MistralClient {
  return new Mistral({
    apiKey,
    serverURL: mistralBaseUrl,
    retryConfig: { strategy: "none" },
    debugLogger: silentLogger,
  });
}

function resolveSelectionControls(
  configured: ModelSelection,
  requested: ModelSelection,
  requestedMaxTokens: number | undefined,
): {
  readonly modelId: string;
  readonly outputTokens: number;
  readonly reasoningEffort?: "none";
} {
  const configuredData = modelSelectionSchema.safeParse(configured);
  const requestedData = modelSelectionSchema.safeParse(requested);
  if (
    !configuredData.success ||
    !requestedData.success ||
    configuredData.data.company !== mistralCompany ||
    requestedData.data.company !== mistralCompany ||
    configuredData.data.modelId !== mistralLarge4ModelId ||
    configuredData.data.modelId !== requestedData.data.modelId ||
    configuredData.data.role !== requestedData.data.role ||
    configuredData.data.promptTemplateVersion !== requestedData.data.promptTemplateVersion ||
    JSON.stringify(configuredData.data.profile) !== JSON.stringify(requestedData.data.profile)
  ) {
    throw invalidRequest(
      "The request does not match the configured Mistral model.",
      "model_mismatch",
    );
  }

  const profile = requestedData.data.profile;
  let outputTokens = requestedMaxTokens ?? defaultMaxOutputTokens;
  let reasoningEffort: "none" | undefined;
  if (profile !== undefined) {
    if (profile.provider !== mistralCompany || profile.modelId !== mistralLarge4ModelId) {
      throw invalidRequest(
        "The selected profile does not match the Mistral model.",
        "profile_mismatch",
      );
    }
    // Only provider-default (send nothing) and disabled thinking (`reasoningEffort: "none"`)
    // are supported; the API accepts only `none` and `high`, and `low` returns 400.
    if (
      profile.runtime.effort !== "provider-default" ||
      (profile.runtime.thinking.mode !== "provider-default" &&
        profile.runtime.thinking.mode !== "disabled")
    ) {
      throw invalidRequest(
        "This Mistral model does not support the selected thinking or effort control.",
        "unsupported_thinking",
      );
    }
    if (
      requestedMaxTokens !== undefined &&
      requestedMaxTokens !== profile.runtime.maxOutputTokens
    ) {
      throw invalidRequest(
        "The request output budget does not match the selected profile.",
        "profile_budget_mismatch",
      );
    }
    // Mistral counts hidden reasoning against `maxTokens`. With reasoning on, the profile's
    // budget is the answer's share and the request allows up to the model limit, so a long
    // revision is not cut off by reasoning it never returns.
    if (profile.runtime.thinking.mode === "disabled") {
      outputTokens = profile.runtime.maxOutputTokens;
      reasoningEffort = "none";
    } else {
      outputTokens = Math.min(profile.knownLimits.maxOutputTokens, maxOutputTokens);
    }
  }

  if (!Number.isSafeInteger(outputTokens) || outputTokens < 1 || outputTokens > maxOutputTokens) {
    throw invalidRequest("The output-token budget is invalid.", "invalid_output_token_budget");
  }
  return {
    modelId: requestedData.data.modelId,
    outputTokens,
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
  };
}

function compileOutputSchema(schema: JsonSchema): CompiledOutputSchema {
  try {
    return compileStructuredOutputSchema(schema);
  } catch {
    throw invalidRequest(
      "The requested output schema cannot be validated safely.",
      "unsupported_output_schema",
    );
  }
}

function malformedResponse(): ProviderAdapterError {
  return failResponse("Mistral returned a malformed response.", "malformed_response");
}

function parseOutput(text: string, schema: CompiledOutputSchema): JsonValue {
  if (text.trim() === "") {
    throw failResponse("Mistral returned no structured output.", "missing_output");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw failResponse("Mistral returned invalid JSON output.", "invalid_json");
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw failResponse(
      "Mistral output did not match the requested schema.",
      "output_schema_mismatch",
      "response-schema-validation",
      summarizeDeepInfraOutputIssues(result.error.issues),
    );
  }
  return parsed as JsonValue;
}

function sha256(value: JsonValue): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

/** Mistral error bodies are inspected for a category only; they are never copied. */
function errorBody(error: unknown): string {
  return isRecord(error) && typeof error.body === "string" ? error.body : "";
}

const interruptedStreamMessage =
  /terminated|incomplete json segment|unexpected end of (?:json|data|stream)|premature close|socket hang up|other side closed|econnreset/iu;

function errorMessage(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 3 && isRecord(current); depth += 1) {
    if (typeof current.message === "string") parts.push(current.message);
    current = current.cause;
  }
  return parts.join(" ");
}

function normalizeMistralError(error: unknown): ProviderAdapterError {
  if (error instanceof ProviderAdapterError) return error;
  const status =
    isRecord(error) && typeof error.statusCode === "number" && Number.isFinite(error.statusCode)
      ? error.statusCode
      : undefined;
  const name = isRecord(error) && typeof error.name === "string" ? error.name : "";

  if (status === 400 || status === 422) {
    return new ProviderAdapterError(
      mistralProvider,
      "invalid-request",
      "Mistral rejected the request.",
      {
        retryable: false,
        status,
        diagnostics: [
          {
            code: /schema/iu.test(errorBody(error))
              ? "provider_rejected_schema"
              : "provider_rejected_request",
            path: "request",
          },
        ],
      },
    );
  }
  if (status === 404) {
    return new ProviderAdapterError(
      mistralProvider,
      "invalid-request",
      "The Mistral model is not available for this request.",
      {
        retryable: false,
        status,
        diagnostics: [{ code: "model_unavailable", path: "error" }],
      },
    );
  }
  if (
    status === undefined &&
    (name === "ResponseValidationError" || name === "SDKValidationError" || name === "ZodError")
  ) {
    return malformedResponse();
  }
  // A body cut off mid-stream surfaces as a plain transport error; it is a temporary failure,
  // so classify it as retryable without exposing its text.
  if (status === undefined && interruptedStreamMessage.test(errorMessage(error))) {
    return new ProviderAdapterError(
      mistralProvider,
      "transient",
      "Mistral ended the response stream early.",
      {
        retryable: true,
        diagnostics: [{ code: "stream_interrupted", path: "response.stream" }],
      },
    );
  }
  if (status === undefined && name === "ConnectionError") {
    return new ProviderAdapterError(mistralProvider, "transient", "Unable to reach Mistral.", {
      retryable: true,
      diagnostics: [{ code: "connection_failed", path: "request" }],
    });
  }
  return normalizeProviderError(mistralProvider, error);
}

function mistralUsage(value: unknown): unknown {
  if (!isRecord(value)) return undefined;
  const mapped: Record<string, unknown> = {};
  if (Object.hasOwn(value, "promptTokens")) mapped.input_tokens = value.promptTokens;
  if (Object.hasOwn(value, "completionTokens")) mapped.output_tokens = value.completionTokens;
  if (Object.hasOwn(value, "totalTokens")) mapped.total_tokens = value.totalTokens;
  return mapped;
}

export class MistralAdapter<
  Input extends JsonValue = JsonValue,
  Output extends JsonValue = JsonValue,
> {
  readonly provider = mistralProvider;
  private readonly client: MistralClient;
  private readonly configuredModel: ModelSelection;
  private readonly pricing: ModelPricing | undefined;
  private readonly retry: RetryOptions;
  private readonly idleTimeoutMs: number;
  private readonly totalTimeoutMs: number;

  constructor(client: MistralClient, options: MistralAdapterOptions) {
    this.client = client;
    this.configuredModel = options.configuredModel;
    this.pricing = options.pricing;
    this.retry = checkedRetryOptions(options.retry);
    this.idleTimeoutMs = checkedTimeout(options.idleTimeoutMs, defaultIdleTimeoutMs);
    this.totalTimeoutMs = checkedTimeout(options.totalTimeoutMs, defaultTotalTimeoutMs);
  }

  async execute(request: ModelRequest<Input>): Promise<ModelResponse<Output>> {
    const controls = resolveSelectionControls(
      this.configuredModel,
      request.model,
      request.maxOutputTokens,
    );
    assertDataExposureAllowed(mistralProvider, request.dataPolicy);
    const outputSchema = compileOutputSchema(request.outputSchema);
    let serializedInput: string;
    try {
      serializedInput = JSON.stringify(request.input);
    } catch {
      throw invalidRequest("The request input cannot be serialized as JSON.", "invalid_input_json");
    }

    const chatRequest: ChatCompletionStreamRequest = {
      model: controls.modelId,
      messages: [
        { role: "system", content: request.systemPrompt },
        { role: "user", content: serializedInput },
      ],
      maxTokens: controls.outputTokens,
      ...(controls.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: controls.reasoningEffort }),
      n: 1,
      stream: true,
      responseFormat: {
        type: "json_schema",
        jsonSchema: {
          name: request.outputName,
          schemaDefinition: request.outputSchema,
          strict: true,
        },
      },
    };

    const startedAt = Date.now();
    request.onProgress?.({ stage: "started", elapsedMs: 0 });
    const retry = { ...this.retry, sleep: cancellableSleep(this.retry.sleep, request.signal) };
    return executeWithRetry(async () => {
      if (request.signal?.aborted) throw canceledError();
      const watchdog = createMistralStreamWatchdog({
        externalSignal: request.signal,
        idleTimeoutMs: this.idleTimeoutMs,
        totalTimeoutMs: this.totalTimeoutMs,
      });
      try {
        const events = await watchdog.run(
          this.client.chat.stream(chatRequest, {
            signal: watchdog.signal,
            retries: { strategy: "none" },
          }),
        );
        watchdog.touch();
        const completion = await collectMistralStream(events, {
          watchdog,
          expectedModelId: controls.modelId,
        });
        if (completion.finishReason === "length") {
          throw failResponse(
            "Mistral reached the output-token limit before completing the structured response.",
            "output_token_limit_reached",
            "output-token-budget-exceeded",
            [
              { code: "stream_answer_characters", count: completion.text.length },
              { code: "stream_reasoning_characters", count: completion.reasoningCharacters },
            ],
          );
        }
        if (completion.finishReason === "model_length") {
          throw failResponse(
            "Mistral reached the model context limit before completing the structured response.",
            "context_length_reached",
          );
        }
        if (completion.finishReason === "content_filter") {
          throw failResponse("Mistral refused the structured response.", "refusal");
        }
        if (completion.finishReason !== "stop") {
          throw failResponse(
            "Mistral did not complete the structured response.",
            "incomplete_response",
          );
        }
        const output = parseOutput(completion.text, outputSchema) as Output;
        const accounting = accountOpenAIUsage(mistralUsage(completion.usage), this.pricing);
        request.onProgress?.({
          stage: "completed",
          elapsedMs: Date.now() - startedAt,
          tokensObserved: accounting.usage.totalTokens,
        });
        return {
          output,
          contextSnapshotId: request.contextSnapshotId,
          provider: mistralProvider,
          company: mistralCompany,
          modelId: controls.modelId,
          providerRequestId: completion.responseId ?? null,
          structuredOutputSha256: sha256(output),
          usage: accounting.usage,
          cost: accounting.cost,
        } satisfies ModelResponse<Output>;
      } catch (error) {
        throw normalizeMistralError(error);
      } finally {
        watchdog.dispose();
      }
    }, retry);
  }
}

export function createMistralAdapter<
  Input extends JsonValue = JsonValue,
  Output extends JsonValue = JsonValue,
>(client: MistralClient, options: MistralAdapterOptions): MistralAdapter<Input, Output> {
  return new MistralAdapter<Input, Output>(client, options);
}
