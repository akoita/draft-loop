import { createHash } from "node:crypto";
import type { ModelSelection } from "@draft-loop/domain";
import { modelSelectionSchema } from "@draft-loop/schemas";
import {
  FinishReason,
  type GenerateContentConfig,
  type GenerateContentParameters,
  GoogleGenAI,
  ThinkingLevel,
} from "@google/genai";
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
  googleGeminiCompany,
  googleGeminiModelId,
  googleGeminiProvider,
} from "./model-identities.js";
import { accountOpenAIUsage } from "./openai-usage.js";
import {
  type CompiledOutputSchema,
  compileStructuredOutputSchema,
  withoutSchemaKeywords,
} from "./structured-output-schema.js";

export { googleGeminiCompany, googleGeminiModelId, googleGeminiProvider };

// Gemini rejects array item-count limits with INVALID_ARGUMENT; local validation still enforces them.
const geminiUnsupportedSchemaKeywords: ReadonlySet<string> = new Set(["maxItems", "minItems"]);
/** The only endpoint the adapter talks to; no custom base URL is accepted. */
export const googleGeminiBaseUrl = "https://generativelanguage.googleapis.com/";

const defaultTimeoutMs = 120_000;
const defaultStreamIdleTimeoutMs = 120_000;
const defaultStreamTotalTimeoutMs = 600_000;
const maxSupportedTimeoutMs = 2_147_483_647;
const defaultMaxOutputTokens = 4096;
const maxOutputTokens = 65_536;
const maximumStreamOutputBytes = 8 * 1024 * 1024;

type StreamTimeoutPhase = "initial" | "idle" | "total";
type StreamRejectionReason =
  | "stream_chunk_envelope"
  | "stream_candidate_count"
  | "stream_candidate_shape"
  | "stream_part_shape"
  | "stream_part_content"
  | "stream_post_terminal_data"
  | "stream_finish_marker";

/** The only SDK surface the adapter uses; tests and callers inject this narrow shape. */
export interface GoogleGeminiClient {
  readonly models: {
    generateContentStream(
      parameters: GenerateContentParameters,
    ): PromiseLike<AsyncIterable<unknown>>;
  };
}

export interface GoogleGeminiAdapterOptions {
  readonly configuredModel: ModelSelection;
  readonly pricing?: ModelPricing;
  readonly retry?: RetryOptions;
  readonly timeoutMs?: number;
}

function invalidRequest(message: string, code: string): ProviderAdapterError {
  return new ProviderAdapterError(googleGeminiProvider, "invalid-request", message, {
    retryable: false,
    diagnostics: [{ code, path: "request" }],
  });
}

function checkedTimeout(value: number | undefined): number {
  const timeout = value ?? defaultTimeoutMs;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > maxSupportedTimeoutMs) {
    throw invalidRequest("The Google Gemini request timeout is invalid.", "invalid_timeout");
  }
  return timeout;
}

function checkedRetryOptions(value: RetryOptions | undefined): RetryOptions {
  const maxRetries = value?.maxRetries ?? 0;
  if (!Number.isSafeInteger(maxRetries) || maxRetries < 0 || maxRetries > 2) {
    throw invalidRequest("The Google Gemini retry limit is invalid.", "invalid_retry_limit");
  }
  return { ...value, maxRetries };
}

/**
 * Build the fixed Gemini API client.
 *
 * The backend, base URL, and API version are pinned so environment variables such as
 * GOOGLE_GEMINI_BASE_URL or GOOGLE_GENAI_USE_VERTEXAI cannot redirect candidate material.
 * SDK retries are disabled (`attempts: 1`); DraftLoop retries through `executeWithRetry`.
 * The SDK `timeout` is deliberately not set: it keeps bounding the response body while it
 * streams, so the adapter enforces its own initial, idle, and total deadlines instead.
 */
export function createGoogleGeminiClient(apiKey: string): GoogleGeminiClient {
  return new GoogleGenAI({
    apiKey,
    vertexai: false,
    httpOptions: {
      baseUrl: googleGeminiBaseUrl,
      retryOptions: { attempts: 1 },
    },
  });
}

function validSelection(
  selection: ModelSelection,
): ReturnType<typeof modelSelectionSchema.parse> | undefined {
  const result = modelSelectionSchema.safeParse(selection);
  return result.success ? result.data : undefined;
}

type GeminiThinkingControl =
  | { readonly kind: "disabled" }
  | { readonly kind: "level"; readonly level: ThinkingLevel };

function resolveSelectionControls(
  configured: ModelSelection,
  requested: ModelSelection,
  requestedMaxTokens: number | undefined,
): { readonly outputTokens: number; readonly thinking?: GeminiThinkingControl } {
  const configuredData = validSelection(configured);
  const requestedData = validSelection(requested);
  if (
    configuredData === undefined ||
    requestedData === undefined ||
    configuredData.company !== googleGeminiCompany ||
    requestedData.company !== googleGeminiCompany ||
    configuredData.modelId !== googleGeminiModelId ||
    requestedData.modelId !== googleGeminiModelId ||
    configuredData.role !== requestedData.role ||
    configuredData.promptTemplateVersion !== requestedData.promptTemplateVersion ||
    JSON.stringify(configuredData.profile) !== JSON.stringify(requestedData.profile)
  ) {
    throw invalidRequest(
      "The request does not match the configured Google Gemini model.",
      "model_mismatch",
    );
  }

  const profile = requestedData.profile;
  let outputTokens = requestedMaxTokens ?? defaultMaxOutputTokens;
  let thinking: GeminiThinkingControl | undefined;
  if (profile !== undefined) {
    if (profile.provider !== googleGeminiCompany || profile.modelId !== googleGeminiModelId) {
      throw invalidRequest(
        "The selected profile does not match the Google Gemini model.",
        "profile_mismatch",
      );
    }
    const thinkingMode = profile.runtime.thinking.mode;
    const selectedEffort = profile.runtime.effort;
    if (thinkingMode !== "provider-default" && thinkingMode !== "disabled") {
      throw invalidRequest(
        "This Google Gemini model does not support the selected thinking control.",
        "unsupported_thinking",
      );
    }
    if (thinkingMode === "disabled" && selectedEffort !== "provider-default") {
      throw invalidRequest(
        "Disabled Google Gemini thinking requires provider-default effort.",
        "unsupported_thinking",
      );
    }
    if (
      selectedEffort !== "provider-default" &&
      selectedEffort !== "low" &&
      selectedEffort !== "high"
    ) {
      throw invalidRequest(
        "This Google Gemini model does not support the selected effort control.",
        "unsupported_effort",
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
    outputTokens = profile.runtime.maxOutputTokens;
    if (thinkingMode === "disabled") thinking = { kind: "disabled" };
    else if (selectedEffort === "low") thinking = { kind: "level", level: ThinkingLevel.LOW };
    else if (selectedEffort === "high") thinking = { kind: "level", level: ThinkingLevel.HIGH };
  }

  if (!Number.isSafeInteger(outputTokens) || outputTokens < 1 || outputTokens > maxOutputTokens) {
    throw invalidRequest("The output-token budget is invalid.", "invalid_output_token_budget");
  }
  return { outputTokens, ...(thinking === undefined ? {} : { thinking }) };
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function failResponse(
  message: string,
  code: string,
  failureStage:
    | "transport-parsing"
    | "response-schema-validation"
    | "output-token-budget-exceeded" = "transport-parsing",
  diagnosticCounts?: readonly { readonly code: string; readonly count: number }[],
): ProviderAdapterError {
  return new ProviderAdapterError(googleGeminiProvider, "invalid-response", message, {
    retryable: false,
    failureStage,
    diagnostics: [{ code, path: "response" }],
    ...(diagnosticCounts === undefined ? {} : { diagnosticCounts }),
  });
}

function malformedStream(reason: StreamRejectionReason): ProviderAdapterError {
  return failResponse(
    "Google Gemini returned a malformed streamed response.",
    "malformed_stream",
    "transport-parsing",
    [{ code: reason, count: 1 }],
  );
}

function parseOutput(text: unknown, schema: CompiledOutputSchema): JsonValue {
  if (typeof text !== "string" || text.trim() === "") {
    throw failResponse("Google Gemini returned no structured output.", "missing_output");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw failResponse("Google Gemini returned invalid JSON output.", "invalid_json");
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new ProviderAdapterError(
      googleGeminiProvider,
      "invalid-response",
      "Google Gemini output did not match the requested schema.",
      {
        retryable: false,
        failureStage: "response-schema-validation",
        diagnostics: [{ code: "output_schema_mismatch", path: "response" }],
        diagnosticCounts: summarizeDeepInfraOutputIssues(result.error.issues),
      },
    );
  }
  return parsed as JsonValue;
}

function sha256(value: JsonValue): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

/** Billing and quota exhaustion are not transient even though Google reports them as HTTP 429. */
function geminiQuotaError(
  error: unknown,
  status: number | undefined,
): ProviderAdapterError | undefined {
  if (status !== 429 && status !== 402) return undefined;
  const message = isRecord(error) && typeof error.message === "string" ? error.message : "";
  const marker =
    /exceeded your current quota|check your plan and billing|billing (?:account|details|is)|(?:credits?|prepayment)[^.]{0,40}(?:depleted|exhausted)|spending cap|insufficient[_ ]quota/iu.test(
      message,
    );
  if (status !== 402 && !marker) return undefined;
  return new ProviderAdapterError(
    googleGeminiProvider,
    "quota-exhausted",
    "The Google Gemini account quota or billing is unavailable for this request.",
    {
      retryable: false,
      ...(status === undefined ? {} : { status }),
      diagnostics: [{ code: "account_quota_unavailable", path: "error" }],
    },
  );
}

function normalizeGeminiError(error: unknown): ProviderAdapterError {
  if (error instanceof ProviderAdapterError) return error;
  const status =
    isRecord(error) && typeof error.status === "number" && Number.isFinite(error.status)
      ? error.status
      : undefined;
  const quota = geminiQuotaError(error, status);
  if (quota !== undefined) return quota;
  const message = isRecord(error) && typeof error.message === "string" ? error.message : "";
  if (status === 400 && /api key not valid|api_key_invalid/iu.test(message)) {
    return new ProviderAdapterError(
      googleGeminiProvider,
      "authentication",
      "The provider request failed (authentication).",
      { retryable: false, status },
    );
  }
  if (status === 404) {
    return new ProviderAdapterError(
      googleGeminiProvider,
      "invalid-request",
      "The Google Gemini model is not available for this request.",
      {
        retryable: false,
        status,
        diagnostics: [{ code: "model_unavailable", path: "error" }],
      },
    );
  }
  // The SDK throws a plain Error when the response stream is cut off mid-way; that is a
  // temporary transport failure, so classify it as retryable without exposing its text.
  if (status === undefined && interruptedStreamMessage.test(message)) {
    return new ProviderAdapterError(
      googleGeminiProvider,
      "transient",
      "Google Gemini ended the response stream early.",
      {
        retryable: true,
        diagnostics: [{ code: "stream_interrupted", path: "response.stream" }],
      },
    );
  }
  return normalizeProviderError(googleGeminiProvider, error);
}

const interruptedStreamMessage =
  /incomplete json segment|unexpected end of (?:json|data|stream)|premature close|socket hang up|other side closed/iu;

function canceledError(): ProviderAdapterError {
  return new ProviderAdapterError(
    googleGeminiProvider,
    "cancelled",
    "The Google Gemini request was cancelled.",
    { retryable: false },
  );
}

function streamTimeoutError(phase: StreamTimeoutPhase): ProviderAdapterError {
  return new ProviderAdapterError(
    googleGeminiProvider,
    "timeout",
    `The Google Gemini response timed out during the ${phase} phase.`,
    {
      retryable: true,
      diagnostics: [{ code: `stream_timeout_${phase}`, path: `response.stream.${phase}` }],
    },
  );
}

function createRequestAbortScope(externalSignal: AbortSignal | undefined): {
  readonly signal: AbortSignal;
  readonly abort: () => void;
  readonly dispose: () => void;
} {
  const controller = new AbortController();
  const forwardAbort = () => controller.abort();
  if (externalSignal?.aborted) controller.abort();
  else externalSignal?.addEventListener("abort", forwardAbort, { once: true });
  return {
    signal: controller.signal,
    abort: () => controller.abort(),
    dispose: () => externalSignal?.removeEventListener("abort", forwardAbort),
  };
}

function awaitWithinStreamDeadline<Value>(
  operation: PromiseLike<Value>,
  options: {
    readonly signal: AbortSignal;
    readonly deadlineAt: number;
    readonly timeoutMs: number;
    readonly phase: Exclude<StreamTimeoutPhase, "total">;
    readonly abort: () => void;
  },
): Promise<Value> {
  const remainingMs = options.deadlineAt - Date.now();
  const timeoutPhase: StreamTimeoutPhase =
    remainingMs <= options.timeoutMs ? "total" : options.phase;
  const waitMs = Math.max(0, Math.min(remainingMs, options.timeoutMs));

  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer);
      options.signal.removeEventListener("abort", onAbort);
    };
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onAbort = () => settle(() => reject(canceledError()));

    if (options.signal.aborted) {
      onAbort();
      return;
    }
    options.signal.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => {
      settle(() => {
        options.abort();
        reject(streamTimeoutError(timeoutPhase));
      });
    }, waitMs);
    Promise.resolve(operation).then(
      (value) => settle(() => resolve(value)),
      (error: unknown) =>
        settle(() => {
          const normalized = normalizeGeminiError(error);
          reject(normalized.code === "timeout" ? streamTimeoutError(timeoutPhase) : normalized);
        }),
    );
  });
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    Symbol.asyncIterator in value &&
    typeof (value as { readonly [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] ===
      "function"
  );
}

/** Rebuild a stream timeout so it also carries content-free answer and reasoning volume. */
function withStreamVolumeCounts(
  error: unknown,
  answerCharacters: number,
  reasoningCharacters: number,
): unknown {
  if (!(error instanceof ProviderAdapterError) || error.code !== "timeout") return error;
  return new ProviderAdapterError(error.provider, error.code, error.message, {
    retryable: error.retryable,
    diagnostics: error.diagnostics,
    diagnosticCounts: [
      { code: "stream_answer_characters", count: answerCharacters },
      { code: "stream_reasoning_characters", count: reasoningCharacters },
    ],
  });
}

function isExpectedModelVersion(value: unknown): boolean {
  return (
    typeof value === "string" &&
    (value === googleGeminiModelId || value.startsWith(`${googleGeminiModelId}-`))
  );
}

const nonTextPartKeys = [
  "functionCall",
  "functionResponse",
  "inlineData",
  "fileData",
  "executableCode",
  "codeExecutionResult",
  "videoMetadata",
  "toolCall",
  "toolResponse",
] as const;

const refusalFinishReasons: ReadonlySet<string> = new Set([
  FinishReason.SAFETY,
  FinishReason.RECITATION,
  FinishReason.BLOCKLIST,
  FinishReason.PROHIBITED_CONTENT,
  FinishReason.SPII,
  FinishReason.IMAGE_SAFETY,
]);

interface CollectedGeminiResponse {
  readonly text: string;
  readonly finishReason: string | undefined;
  readonly responseId: string | undefined;
  readonly usageMetadata: unknown;
}

async function collectGeminiStream(
  stream: AsyncIterable<unknown>,
  options: {
    readonly signal: AbortSignal;
    readonly abort: () => void;
    readonly deadlineAt: number;
  },
): Promise<CollectedGeminiResponse> {
  const iterator = stream[Symbol.asyncIterator]();
  let completed = false;
  let text = "";
  let textBytes = 0;
  let answerCharacters = 0;
  let reasoningCharacters = 0;
  let finishReason: string | undefined;
  let responseId: string | undefined;
  let usageMetadata: unknown;

  try {
    while (true) {
      if (Date.now() >= options.deadlineAt) throw streamTimeoutError("total");
      const next = await awaitWithinStreamDeadline(iterator.next(), {
        signal: options.signal,
        deadlineAt: options.deadlineAt,
        timeoutMs: defaultStreamIdleTimeoutMs,
        phase: "idle",
        abort: options.abort,
      });
      if (next.done) {
        completed = true;
        break;
      }
      if (Date.now() >= options.deadlineAt) throw streamTimeoutError("total");
      const chunk: unknown = next.value;
      if (!isRecord(chunk)) throw malformedStream("stream_chunk_envelope");

      if (chunk.modelVersion !== undefined && !isExpectedModelVersion(chunk.modelVersion)) {
        throw failResponse(
          "Google Gemini returned a response from an unexpected model.",
          "unexpected_response_model",
        );
      }
      if (responseId === undefined && typeof chunk.responseId === "string") {
        if (chunk.responseId.trim() !== "") responseId = chunk.responseId;
      }
      if (chunk.usageMetadata !== undefined && chunk.usageMetadata !== null) {
        usageMetadata = chunk.usageMetadata;
      }
      if (isRecord(chunk.promptFeedback)) {
        const blockReason = chunk.promptFeedback.blockReason;
        if (
          typeof blockReason === "string" &&
          blockReason !== "" &&
          blockReason !== "BLOCKED_REASON_UNSPECIFIED"
        ) {
          throw failResponse("Google Gemini blocked the request prompt.", "prompt_blocked");
        }
      }

      if (chunk.candidates === undefined || chunk.candidates === null) continue;
      if (!Array.isArray(chunk.candidates)) throw malformedStream("stream_candidate_shape");
      if (chunk.candidates.length === 0) continue;
      if (chunk.candidates.length !== 1) throw malformedStream("stream_candidate_count");
      const candidate: unknown = chunk.candidates[0];
      if (!isRecord(candidate)) throw malformedStream("stream_candidate_shape");
      if (
        candidate.index !== undefined &&
        (!Number.isSafeInteger(candidate.index) || candidate.index !== 0)
      ) {
        throw malformedStream("stream_candidate_count");
      }

      const content = candidate.content;
      if (content !== undefined && content !== null) {
        if (!isRecord(content)) throw malformedStream("stream_candidate_shape");
        const parts = content.parts;
        if (parts !== undefined && parts !== null) {
          if (!Array.isArray(parts)) throw malformedStream("stream_part_shape");
          for (const part of parts as unknown[]) {
            if (!isRecord(part)) throw malformedStream("stream_part_shape");
            if (nonTextPartKeys.some((key) => part[key] !== undefined && part[key] !== null)) {
              throw malformedStream("stream_part_content");
            }
            if (part.thought !== undefined && typeof part.thought !== "boolean") {
              throw malformedStream("stream_part_shape");
            }
            if (part.text === undefined || part.text === null) continue;
            if (typeof part.text !== "string") throw malformedStream("stream_part_shape");
            if (finishReason !== undefined && part.text !== "") {
              throw malformedStream("stream_post_terminal_data");
            }
            if (part.thought === true) {
              // Thought text is only measured; it is never stored or mixed into the answer.
              reasoningCharacters += part.text.length;
              continue;
            }
            textBytes += Buffer.byteLength(part.text, "utf8");
            if (textBytes > maximumStreamOutputBytes) {
              throw failResponse(
                "Google Gemini returned an oversized structured response.",
                "output_too_large",
              );
            }
            text += part.text;
            answerCharacters += part.text.length;
          }
        }
      }

      if (candidate.finishReason !== undefined && candidate.finishReason !== null) {
        if (typeof candidate.finishReason !== "string") {
          throw malformedStream("stream_finish_marker");
        }
        if (candidate.finishReason !== FinishReason.FINISH_REASON_UNSPECIFIED) {
          if (finishReason !== undefined && finishReason !== candidate.finishReason) {
            throw malformedStream("stream_finish_marker");
          }
          finishReason = candidate.finishReason;
        }
      }
    }
  } catch (error) {
    throw withStreamVolumeCounts(error, answerCharacters, reasoningCharacters);
  } finally {
    if (!completed && typeof iterator.return === "function") {
      try {
        void Promise.resolve(iterator.return()).catch(() => undefined);
      } catch {
        // Iterator cleanup is best effort and must never delay timeout or cancellation.
      }
    }
  }

  return { text, finishReason, responseId, usageMetadata };
}

function geminiUsage(value: unknown): unknown {
  if (!isRecord(value)) return undefined;
  const mapped: Record<string, unknown> = {};
  if (Object.hasOwn(value, "promptTokenCount")) mapped.input_tokens = value.promptTokenCount;

  // Thought tokens are billed as output and are not part of candidatesTokenCount.
  const candidates = value.candidatesTokenCount;
  const thoughts = value.thoughtsTokenCount;
  const hasThoughts = thoughts !== undefined && thoughts !== null;
  const validCount = (count: unknown): count is number =>
    typeof count === "number" && Number.isSafeInteger(count) && count >= 0;
  if (candidates !== undefined) {
    mapped.output_tokens =
      validCount(candidates) && (!hasThoughts || validCount(thoughts))
        ? candidates + (hasThoughts ? thoughts : 0)
        : Number.NaN;
  }
  if (hasThoughts) mapped.output_tokens_details = { reasoning_tokens: thoughts };
  if (Object.hasOwn(value, "cachedContentTokenCount")) {
    mapped.input_tokens_details = { cached_tokens: value.cachedContentTokenCount };
  }
  return mapped;
}

export class GoogleGeminiAdapter<
  Input extends JsonValue = JsonValue,
  Output extends JsonValue = JsonValue,
> {
  readonly provider = googleGeminiProvider;
  private readonly client: GoogleGeminiClient;
  private readonly configuredModel: ModelSelection;
  private readonly pricing: ModelPricing | undefined;
  private readonly retry: RetryOptions;
  private readonly timeoutMs: number;

  constructor(client: GoogleGeminiClient, options: GoogleGeminiAdapterOptions) {
    this.client = client;
    this.configuredModel = options.configuredModel;
    this.pricing = options.pricing;
    this.retry = checkedRetryOptions(options.retry);
    this.timeoutMs = checkedTimeout(options.timeoutMs);
  }

  async execute(request: ModelRequest<Input>): Promise<ModelResponse<Output>> {
    const controls = resolveSelectionControls(
      this.configuredModel,
      request.model,
      request.maxOutputTokens,
    );
    assertDataExposureAllowed(googleGeminiProvider, request.dataPolicy);
    const outputSchema = compileOutputSchema(request.outputSchema);
    let serializedInput: string;
    try {
      serializedInput = JSON.stringify(request.input);
    } catch {
      throw invalidRequest("The request input cannot be serialized as JSON.", "invalid_input_json");
    }

    const baseConfig: GenerateContentConfig = {
      systemInstruction: request.systemPrompt,
      responseMimeType: "application/json",
      responseJsonSchema: withoutSchemaKeywords(
        request.outputSchema,
        geminiUnsupportedSchemaKeywords,
      ),
      maxOutputTokens: controls.outputTokens,
      candidateCount: 1,
      ...(controls.thinking === undefined
        ? {}
        : {
            thinkingConfig:
              controls.thinking.kind === "disabled"
                ? { thinkingBudget: 0 }
                : { thinkingLevel: controls.thinking.level },
          }),
    };

    const startedAt = Date.now();
    const deadlineAt = startedAt + defaultStreamTotalTimeoutMs;
    request.onProgress?.({ stage: "started", elapsedMs: 0 });
    return executeWithRetry(async () => {
      if (request.signal?.aborted) throw canceledError();
      const abortScope = createRequestAbortScope(request.signal);
      try {
        if (Date.now() >= deadlineAt) throw streamTimeoutError("total");
        const pendingResponse = this.client.models.generateContentStream({
          model: googleGeminiModelId,
          contents: [{ role: "user", parts: [{ text: serializedInput }] }],
          config: { ...baseConfig, abortSignal: abortScope.signal },
        });
        const initialResponse = await awaitWithinStreamDeadline(pendingResponse, {
          signal: abortScope.signal,
          deadlineAt,
          timeoutMs: this.timeoutMs,
          phase: "initial",
          abort: abortScope.abort,
        });
        if (!isAsyncIterable(initialResponse)) {
          throw failResponse(
            "Google Gemini returned a malformed streamed response.",
            "malformed_stream",
          );
        }
        const response = await collectGeminiStream(initialResponse, {
          signal: abortScope.signal,
          abort: abortScope.abort,
          deadlineAt,
        });
        if (response.finishReason === FinishReason.MAX_TOKENS) {
          throw failResponse(
            "Google Gemini reached the output-token limit before completing the structured response.",
            "output_token_limit_reached",
            "output-token-budget-exceeded",
          );
        }
        if (
          response.finishReason !== undefined &&
          refusalFinishReasons.has(response.finishReason)
        ) {
          throw failResponse("Google Gemini refused the structured response.", "refusal");
        }
        if (response.finishReason !== FinishReason.STOP) {
          throw failResponse(
            "Google Gemini did not complete the structured response.",
            "incomplete_response",
          );
        }
        const output = parseOutput(response.text, outputSchema) as Output;
        const accounting = accountOpenAIUsage(geminiUsage(response.usageMetadata), this.pricing);
        request.onProgress?.({
          stage: "completed",
          elapsedMs: Date.now() - startedAt,
          tokensObserved: accounting.usage.totalTokens,
        });
        return {
          output,
          contextSnapshotId: request.contextSnapshotId,
          provider: googleGeminiProvider,
          company: googleGeminiCompany,
          modelId: googleGeminiModelId,
          providerRequestId: response.responseId ?? null,
          structuredOutputSha256: sha256(output),
          usage: accounting.usage,
          cost: accounting.cost,
        } satisfies ModelResponse<Output>;
      } catch (error) {
        throw normalizeGeminiError(error);
      } finally {
        abortScope.abort();
        abortScope.dispose();
      }
    }, this.retry);
  }
}

export function createGoogleGeminiAdapter<
  Input extends JsonValue = JsonValue,
  Output extends JsonValue = JsonValue,
>(
  client: GoogleGeminiClient,
  options: GoogleGeminiAdapterOptions,
): GoogleGeminiAdapter<Input, Output> {
  return new GoogleGeminiAdapter<Input, Output>(client, options);
}
