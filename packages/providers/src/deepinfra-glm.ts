import { createHash } from "node:crypto";
import type { ModelSelection } from "@draft-loop/domain";
import { modelSelectionSchema } from "@draft-loop/schemas";
import OpenAI from "openai";
import type {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
} from "openai/resources/chat/completions";
import { z } from "zod";
import { summarizeDeepInfraOutputIssues } from "./deepinfra-output-diagnostics.js";
import {
  type DeepInfraStreamRejectionReasonCode,
  deepInfraStreamRejectionCount,
} from "./deepinfra-stream-diagnostics.js";
import {
  assertDataExposureAllowed,
  executeWithRetry,
  type JsonObject,
  type JsonSchema,
  type JsonValue,
  type ModelPricing,
  type ModelRequest,
  type ModelResponse,
  normalizeProviderError,
  ProviderAdapterError,
  type RetryOptions,
} from "./index.js";
import { accountOpenAIUsage } from "./openai-usage.js";

export const deepInfraGLMProvider = "deepinfra" as const;
export const deepInfraGLMCompany = "zai" as const;
export const deepInfraGLMModelId = "zai-org/GLM-5.3-Flash" as const;
export const deepInfraGLMBaseUrl = "https://api.deepinfra.com/v1/openai";

const defaultTimeoutMs = 120_000;
const defaultStreamIdleTimeoutMs = 120_000;
const defaultStreamTotalTimeoutMs = 600_000;
const maxSupportedTimeoutMs = 2_147_483_647;
const defaultMaxOutputTokens = 4096;
const maxOutputTokens = 131_072;
const maximumStreamOutputBytes = 8 * 1024 * 1024;

type DeepInfraGLMCreateParameters =
  | ChatCompletionCreateParamsNonStreaming
  | ChatCompletionCreateParamsStreaming;
type DeepInfraGLMCompletion = ChatCompletion | AsyncIterable<ChatCompletionChunk>;
type StreamTimeoutPhase = "initial" | "idle" | "total";

export interface DeepInfraGLMCreateOptions {
  readonly timeoutMs?: number;
}

export interface DeepInfraGLMRequestOptions {
  readonly maxRetries: 0;
  readonly timeout: number;
  readonly signal?: AbortSignal;
}

export interface DeepInfraGLMClient {
  readonly chat: {
    readonly completions: {
      create(
        parameters: DeepInfraGLMCreateParameters,
        options?: DeepInfraGLMRequestOptions,
      ): PromiseLike<DeepInfraGLMCompletion>;
    };
  };
}

export interface DeepInfraGLMAdapterOptions {
  readonly configuredModel: ModelSelection;
  readonly pricing?: ModelPricing;
  readonly retry?: RetryOptions;
  readonly timeoutMs?: number;
}

function invalidRequest(message: string, code: string): ProviderAdapterError {
  return new ProviderAdapterError(deepInfraGLMProvider, "invalid-request", message, {
    retryable: false,
    diagnostics: [{ code, path: "request" }],
  });
}

function checkedTimeout(value: number | undefined): number {
  const timeout = value ?? defaultTimeoutMs;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > maxSupportedTimeoutMs) {
    throw invalidRequest("The DeepInfra request timeout is invalid.", "invalid_timeout");
  }
  return timeout;
}

function checkedRetryOptions(value: RetryOptions | undefined): RetryOptions {
  const maxRetries = value?.maxRetries ?? 0;
  if (!Number.isSafeInteger(maxRetries) || maxRetries < 0 || maxRetries > 2) {
    throw invalidRequest("The DeepInfra retry limit is invalid.", "invalid_retry_limit");
  }
  return { ...value, maxRetries };
}

/** Build the fixed DeepInfra OpenAI-compatible client; no other host is accepted. */
export function createDeepInfraGLMClient(
  apiKey: string,
  options: DeepInfraGLMCreateOptions = {},
): DeepInfraGLMClient {
  const timeout = checkedTimeout(options.timeoutMs);
  return new OpenAI({
    apiKey,
    baseURL: deepInfraGLMBaseUrl,
    maxRetries: 0,
    timeout,
  }) as DeepInfraGLMClient;
}

function validSelection(
  selection: ModelSelection,
): ReturnType<typeof modelSelectionSchema.parse> | undefined {
  const result = modelSelectionSchema.safeParse(selection);
  return result.success ? result.data : undefined;
}

function resolveSelectionControls(
  configured: ModelSelection,
  requested: ModelSelection,
  requestedMaxTokens: number | undefined,
): { readonly outputTokens: number; readonly effort?: "low" | "high" | "max" } {
  const configuredData = validSelection(configured);
  const requestedData = validSelection(requested);
  if (
    configuredData === undefined ||
    requestedData === undefined ||
    configuredData.company !== deepInfraGLMCompany ||
    requestedData.company !== deepInfraGLMCompany ||
    configuredData.modelId !== deepInfraGLMModelId ||
    requestedData.modelId !== deepInfraGLMModelId ||
    configuredData.company !== requestedData.company ||
    configuredData.modelId !== requestedData.modelId ||
    configuredData.role !== requestedData.role ||
    configuredData.promptTemplateVersion !== requestedData.promptTemplateVersion ||
    JSON.stringify(configuredData.profile) !== JSON.stringify(requestedData.profile)
  ) {
    throw invalidRequest(
      "The request does not match the configured DeepInfra model.",
      "model_mismatch",
    );
  }

  const profile = requestedData.profile;
  let outputTokens = requestedMaxTokens ?? defaultMaxOutputTokens;
  let effort: "low" | "high" | "max" | undefined;
  if (profile !== undefined) {
    if (profile.provider !== deepInfraGLMCompany || profile.modelId !== deepInfraGLMModelId) {
      throw invalidRequest(
        "The selected profile does not match the DeepInfra model.",
        "profile_mismatch",
      );
    }
    if (profile.runtime.thinking.mode !== "provider-default") {
      throw invalidRequest(
        "This DeepInfra model does not support the selected thinking control.",
        "unsupported_thinking",
      );
    }
    const selectedEffort = profile.runtime.effort;
    if (
      selectedEffort !== "provider-default" &&
      selectedEffort !== "low" &&
      selectedEffort !== "high" &&
      selectedEffort !== "max"
    ) {
      throw invalidRequest(
        "This DeepInfra model does not support the selected effort control.",
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
    effort = selectedEffort === "provider-default" ? undefined : selectedEffort;
  }

  if (!Number.isSafeInteger(outputTokens) || outputTokens < 1 || outputTokens > maxOutputTokens) {
    throw invalidRequest("The output-token budget is invalid.", "invalid_output_token_budget");
  }
  return { outputTokens, ...(effort === undefined ? {} : { effort }) };
}

const singleSchemaKeywords = new Set([
  "additionalItems",
  "additionalProperties",
  "contains",
  "contentSchema",
  "else",
  "if",
  "items",
  "not",
  "propertyNames",
  "then",
  "unevaluatedItems",
  "unevaluatedProperties",
]);
const schemaArrayKeywords = new Set(["allOf", "anyOf", "oneOf", "prefixItems"]);
const schemaMapKeywords = new Set([
  "$defs",
  "definitions",
  "dependentSchemas",
  "patternProperties",
  "properties",
]);

function withoutSchemaDefaults(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map((item) => withoutSchemaDefaults(item));
  if (!isRecord(value)) return value as JsonValue;

  const entries = Object.entries(value).flatMap(([key, child]): [string, JsonValue][] => {
    if (key === "default") return [];
    if (singleSchemaKeywords.has(key)) {
      return [[key, withoutSchemaDefaults(child as JsonValue)]];
    }
    if (schemaArrayKeywords.has(key) && Array.isArray(child)) {
      return [[key, child.map((schema) => withoutSchemaDefaults(schema as JsonValue))]];
    }
    if (schemaMapKeywords.has(key) && isRecord(child)) {
      return [
        [
          key,
          Object.fromEntries(
            Object.entries(child).map(([name, schema]) => [
              name,
              withoutSchemaDefaults(schema as JsonValue),
            ]),
          ),
        ],
      ];
    }
    if (key === "dependencies" && isRecord(child)) {
      return [
        [
          key,
          Object.fromEntries(
            Object.entries(child).map(([name, dependency]) => [
              name,
              Array.isArray(dependency)
                ? dependency
                : withoutSchemaDefaults(dependency as JsonValue),
            ]),
          ),
        ],
      ];
    }
    return [[key, child as JsonValue]];
  });
  return Object.fromEntries(entries) as JsonObject;
}

function compileOutputSchema(schema: JsonSchema): ReturnType<typeof z.fromJSONSchema> {
  try {
    // Defaults are annotations for generation, not permission to repair provider output.
    // Compile a detached schema copy so required fields remain required while the original
    // schema sent over the wire and the returned JSON stay untouched.
    return z.fromJSONSchema(
      withoutSchemaDefaults(schema) as Parameters<typeof z.fromJSONSchema>[0],
    );
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
  return new ProviderAdapterError(deepInfraGLMProvider, "invalid-response", message, {
    retryable: false,
    failureStage,
    diagnostics: [{ code, path: "response" }],
    ...(diagnosticCounts === undefined ? {} : { diagnosticCounts }),
  });
}

function parseOutput(text: unknown, schema: ReturnType<typeof z.fromJSONSchema>): JsonValue {
  if (typeof text !== "string" || text.trim() === "") {
    throw failResponse("DeepInfra returned no structured output.", "missing_output");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw failResponse("DeepInfra returned invalid JSON output.", "invalid_json");
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new ProviderAdapterError(
      deepInfraGLMProvider,
      "invalid-response",
      "DeepInfra output did not match the requested schema.",
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

function deepInfraBillingError(error: unknown): ProviderAdapterError | undefined {
  if (!isRecord(error)) return undefined;
  const nested = isRecord(error.error) ? error.error : undefined;
  const nestedBody = nested !== undefined && isRecord(nested.error) ? nested.error : undefined;
  const statusValue = error.status ?? error.statusCode ?? nested?.status ?? nested?.statusCode;
  const status = typeof statusValue === "number" ? statusValue : undefined;
  const codeValues = [error.code, error.type, nested?.code, nested?.type, nestedBody?.code];
  const messageValues = [error.message, nested?.message, nestedBody?.message];
  const codes = codeValues
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim().toLowerCase());
  const messages = messageValues
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.toLowerCase());
  const marker =
    codes.some((code) =>
      [
        "insufficient_credits",
        "insufficient_quota",
        "credits_exhausted",
        "credit_exhausted",
        "out_of_credits",
        "insufficient_balance",
        "billing_limit_reached",
      ].includes(code),
    ) ||
    messages.some((message) =>
      /\b(?:insufficient|not enough|out of|exhausted)\s+(?:account\s+)?(?:api\s+)?credits?\b|\bcredits?\s+(?:exhausted|depleted)\b|\binsufficient_quota\b/iu.test(
        message,
      ),
    );
  if (status !== 402 && !marker) return undefined;
  return new ProviderAdapterError(
    deepInfraGLMProvider,
    "quota-exhausted",
    "DeepInfra account credits are unavailable for this request.",
    {
      retryable: false,
      ...(status === undefined ? {} : { status }),
      diagnostics: [{ code: "account_credits_unavailable", path: "error" }],
    },
  );
}

function normalizeDeepInfraError(error: unknown): ProviderAdapterError {
  return deepInfraBillingError(error) ?? normalizeProviderError(deepInfraGLMProvider, error);
}

function chatUsage(value: unknown): unknown {
  if (!isRecord(value)) return undefined;
  const mapped: Record<string, unknown> = {};
  const fields = [
    ["prompt_tokens", "input_tokens"],
    ["completion_tokens", "output_tokens"],
    ["total_tokens", "total_tokens"],
    ["prompt_tokens_details", "input_tokens_details"],
    ["completion_tokens_details", "output_tokens_details"],
  ] as const;
  for (const [source, target] of fields) {
    if (Object.hasOwn(value, source)) mapped[target] = value[source];
  }
  return mapped;
}

function canceledError(): ProviderAdapterError {
  return new ProviderAdapterError(
    deepInfraGLMProvider,
    "cancelled",
    "The DeepInfra request was cancelled.",
    { retryable: false },
  );
}

function streamTimeoutError(phase: StreamTimeoutPhase): ProviderAdapterError {
  return new ProviderAdapterError(
    deepInfraGLMProvider,
    "timeout",
    `The DeepInfra response timed out during the ${phase} phase.`,
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
          const normalized = normalizeDeepInfraError(error);
          reject(normalized.code === "timeout" ? streamTimeoutError(timeoutPhase) : normalized);
        }),
    );
  });
}

function isAsyncIterable(value: unknown): value is AsyncIterable<ChatCompletionChunk> {
  return (
    typeof value === "object" &&
    value !== null &&
    Symbol.asyncIterator in value &&
    typeof (value as { readonly [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] ===
      "function"
  );
}

function malformedStream(reason: DeepInfraStreamRejectionReasonCode): ProviderAdapterError {
  return failResponse(
    "DeepInfra returned a malformed streamed response.",
    "malformed_stream",
    "transport-parsing",
    [deepInfraStreamRejectionCount(reason)],
  );
}

async function collectStreamCompletion(
  stream: AsyncIterable<ChatCompletionChunk>,
  options: {
    readonly signal: AbortSignal;
    readonly abort: () => void;
    readonly deadlineAt: number;
    readonly expectedModel: string;
  },
): Promise<Pick<ChatCompletion, "id" | "model" | "choices" | "usage">> {
  const iterator = stream[Symbol.asyncIterator]();
  let completed = false;
  let id: string | undefined;
  let model: string | undefined;
  let created: number | undefined;
  let content = "";
  let contentBytes = 0;
  let refusal: string | null = null;
  let finishReason: ChatCompletion.Choice["finish_reason"] | undefined;
  let usage: ChatCompletion["usage"] | undefined;
  let usageOnlyChunkSeen = false;

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
      if (
        typeof chunk.id !== "string" ||
        chunk.id.trim() === "" ||
        (id !== undefined && id !== chunk.id)
      ) {
        throw malformedStream("stream_chunk_identity");
      }
      if (chunk.object !== "chat.completion.chunk" || !Array.isArray(chunk.choices)) {
        throw malformedStream("stream_chunk_envelope");
      }
      id = chunk.id;
      if (Object.hasOwn(chunk, "model")) {
        if (
          typeof chunk.model !== "string" ||
          chunk.model !== options.expectedModel ||
          (model !== undefined && model !== chunk.model)
        ) {
          throw malformedStream("stream_model_metadata");
        }
        model = chunk.model;
      }
      if (Object.hasOwn(chunk, "created")) {
        if (
          typeof chunk.created !== "number" ||
          !Number.isSafeInteger(chunk.created) ||
          (created !== undefined && created !== chunk.created)
        ) {
          throw malformedStream("stream_timestamp_metadata");
        }
        created = chunk.created;
      }

      if (Object.hasOwn(chunk, "usage") && chunk.usage !== undefined) {
        usage = chunk.usage as ChatCompletion["usage"];
      }

      if (chunk.choices.length === 0) {
        if (
          finishReason === undefined ||
          chunk.usage === undefined ||
          chunk.usage === null ||
          usageOnlyChunkSeen
        ) {
          throw malformedStream("stream_usage_sequence");
        }
        usageOnlyChunkSeen = true;
        continue;
      }
      if (finishReason !== undefined) throw malformedStream("stream_post_terminal_data");
      if (chunk.choices.length !== 1) throw malformedStream("stream_choice_count");

      const choice = chunk.choices[0];
      if (!isRecord(choice)) throw malformedStream("stream_choice_shape");
      if (!isRecord(choice.delta)) throw malformedStream("stream_delta_type");
      if (
        Object.hasOwn(choice, "index") &&
        (!Number.isSafeInteger(choice.index) || choice.index !== 0)
      ) {
        throw malformedStream("stream_choice_index");
      }
      const delta = choice.delta;
      if (delta.role !== undefined && delta.role !== null && delta.role !== "assistant") {
        throw malformedStream("stream_role");
      }
      if (
        (delta.tool_calls !== undefined && delta.tool_calls !== null) ||
        (delta.function_call !== undefined && delta.function_call !== null)
      ) {
        throw malformedStream("stream_tool_data");
      }
      if (delta.content !== undefined && delta.content !== null) {
        if (typeof delta.content !== "string") throw malformedStream("stream_content_type");
        contentBytes += Buffer.byteLength(delta.content, "utf8");
        if (contentBytes > maximumStreamOutputBytes) {
          throw failResponse(
            "DeepInfra returned an oversized structured response.",
            "output_too_large",
          );
        }
        content += delta.content;
      }
      if (delta.refusal !== undefined && delta.refusal !== null) {
        if (typeof delta.refusal !== "string") throw malformedStream("stream_refusal_type");
        if (delta.refusal !== "") refusal = "DeepInfra refused the structured response.";
      }
      if (choice.finish_reason !== undefined && choice.finish_reason !== null) {
        if (typeof choice.finish_reason !== "string") {
          throw malformedStream("stream_finish_marker");
        }
        finishReason = choice.finish_reason as ChatCompletion.Choice["finish_reason"];
      }
    }
  } finally {
    if (!completed && typeof iterator.return === "function") {
      try {
        void Promise.resolve(iterator.return()).catch(() => undefined);
      } catch {
        // Iterator cleanup is best effort and must never delay timeout or cancellation.
      }
    }
  }

  if (id === undefined || finishReason === undefined) {
    throw failResponse(
      "DeepInfra ended the stream before completing the response.",
      "incomplete_stream",
    );
  }

  return {
    id,
    model: model ?? options.expectedModel,
    choices: [
      {
        index: 0,
        finish_reason: finishReason,
        logprobs: null,
        message: {
          role: "assistant",
          content,
          refusal,
        },
      },
    ],
    ...(usage === undefined ? {} : { usage }),
  } as unknown as Pick<ChatCompletion, "id" | "model" | "choices" | "usage">;
}

export class DeepInfraGLMAdapter<
  Input extends JsonValue = JsonValue,
  Output extends JsonValue = JsonValue,
> {
  readonly provider = deepInfraGLMProvider;
  private readonly client: DeepInfraGLMClient;
  private readonly configuredModel: ModelSelection;
  private readonly pricing: ModelPricing | undefined;
  private readonly retry: RetryOptions;
  private readonly timeoutMs: number;

  constructor(client: DeepInfraGLMClient, options: DeepInfraGLMAdapterOptions) {
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
    assertDataExposureAllowed(deepInfraGLMProvider, request.dataPolicy);
    const outputSchema = compileOutputSchema(request.outputSchema);
    let serializedInput: string;
    try {
      serializedInput = JSON.stringify(request.input);
    } catch {
      throw invalidRequest("The request input cannot be serialized as JSON.", "invalid_input_json");
    }

    const parameters: ChatCompletionCreateParamsStreaming = {
      model: deepInfraGLMModelId,
      messages: [
        { role: "system", content: request.systemPrompt },
        { role: "user", content: serializedInput },
      ],
      max_tokens: controls.outputTokens,
      n: 1,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: request.outputName,
          schema: request.outputSchema,
          strict: true,
        },
      },
      stream: true,
      stream_options: { include_usage: true },
      ...(controls.effort === undefined ? {} : { reasoning_effort: controls.effort }),
    };

    const startedAt = Date.now();
    const deadlineAt = startedAt + defaultStreamTotalTimeoutMs;
    request.onProgress?.({ stage: "started", elapsedMs: 0 });
    return executeWithRetry(async () => {
      if (request.signal?.aborted) throw canceledError();
      const abortScope = createRequestAbortScope(request.signal);
      try {
        if (Date.now() >= deadlineAt) throw streamTimeoutError("total");
        const pendingResponse = this.client.chat.completions.create(parameters, {
          maxRetries: 0,
          timeout: this.timeoutMs,
          signal: abortScope.signal,
        });
        const initialResponse = await awaitWithinStreamDeadline(pendingResponse, {
          signal: abortScope.signal,
          deadlineAt,
          timeoutMs: this.timeoutMs,
          phase: "initial",
          abort: abortScope.abort,
        });
        const response = isAsyncIterable(initialResponse)
          ? await collectStreamCompletion(initialResponse, {
              signal: abortScope.signal,
              abort: abortScope.abort,
              deadlineAt,
              expectedModel: parameters.model,
            })
          : initialResponse;
        if (response.model !== deepInfraGLMModelId) {
          throw failResponse(
            "DeepInfra returned a response from an unexpected model.",
            "unexpected_response_model",
          );
        }
        if (!Array.isArray(response.choices) || response.choices.length !== 1) {
          throw failResponse(
            "DeepInfra returned an unexpected completion count.",
            "unexpected_choice_count",
          );
        }
        const choice = response.choices[0];
        if (choice === undefined || !isRecord(choice.message)) {
          throw failResponse("DeepInfra returned a malformed completion.", "malformed_completion");
        }
        if (choice.finish_reason === "length") {
          throw failResponse(
            "DeepInfra reached the output-token limit before completing the structured response.",
            "output_token_limit_reached",
            "output-token-budget-exceeded",
          );
        }
        if (choice.message.refusal !== null && choice.message.refusal !== undefined) {
          throw failResponse("DeepInfra refused the structured response.", "refusal");
        }
        if (choice.finish_reason !== "stop") {
          throw failResponse(
            "DeepInfra did not complete the structured response.",
            "incomplete_response",
          );
        }
        const output = parseOutput(choice.message.content, outputSchema) as Output;
        const accounting = accountOpenAIUsage(chatUsage(response.usage), this.pricing);
        request.onProgress?.({
          stage: "completed",
          elapsedMs: Date.now() - startedAt,
          tokensObserved: accounting.usage.totalTokens,
        });
        return {
          output,
          contextSnapshotId: request.contextSnapshotId,
          provider: deepInfraGLMProvider,
          company: deepInfraGLMCompany,
          modelId: deepInfraGLMModelId,
          providerRequestId: typeof response.id === "string" ? response.id : null,
          structuredOutputSha256: sha256(output),
          usage: accounting.usage,
          cost: accounting.cost,
        } satisfies ModelResponse<Output>;
      } catch (error) {
        throw normalizeDeepInfraError(error);
      } finally {
        abortScope.abort();
        abortScope.dispose();
      }
    }, this.retry);
  }
}

export function createDeepInfraGLMAdapter<
  Input extends JsonValue = JsonValue,
  Output extends JsonValue = JsonValue,
>(
  client: DeepInfraGLMClient,
  options: DeepInfraGLMAdapterOptions,
): DeepInfraGLMAdapter<Input, Output> {
  return new DeepInfraGLMAdapter<Input, Output>(client, options);
}
