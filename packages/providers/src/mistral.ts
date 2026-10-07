import { createHash } from "node:crypto";
import type { ModelSelection } from "@draft-loop/domain";
import { modelSelectionSchema } from "@draft-loop/schemas";
import { Mistral } from "@mistralai/mistralai";
import type { RequestOptions } from "@mistralai/mistralai/lib/sdks.js";
import type { ChatCompletionRequest } from "@mistralai/mistralai/models/components";
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
import { mistralCompany, mistralLarge4ModelId, mistralProvider } from "./model-identities.js";
import { accountOpenAIUsage } from "./openai-usage.js";
import {
  type CompiledOutputSchema,
  compileStructuredOutputSchema,
} from "./structured-output-schema.js";

export { mistralCompany, mistralLarge4ModelId, mistralProvider };

/** The only endpoint host the adapter talks to; no custom base URL is accepted. */
export const mistralBaseUrl = "https://api.mistral.ai";

const defaultTimeoutMs = 300_000;
const maxSupportedTimeoutMs = 2_147_483_647;
const defaultMaxOutputTokens = 4096;
const maxOutputTokens = 65_536;
const maximumOutputBytes = 8 * 1024 * 1024;

type MistralRequestOptions = Pick<RequestOptions, "signal" | "retries" | "timeoutMs">;

/** The only SDK surface the adapter uses; tests and callers inject this narrow shape. */
export interface MistralClient {
  readonly chat: {
    complete(request: ChatCompletionRequest, options?: MistralRequestOptions): PromiseLike<unknown>;
  };
}

export interface MistralAdapterOptions {
  readonly configuredModel: ModelSelection;
  readonly pricing?: ModelPricing;
  readonly retry?: RetryOptions;
  readonly timeoutMs?: number;
}

function invalidRequest(message: string, code: string): ProviderAdapterError {
  return new ProviderAdapterError(mistralProvider, "invalid-request", message, {
    retryable: false,
    diagnostics: [{ code, path: "request" }],
  });
}

function checkedTimeout(value: number | undefined): number {
  const timeout = value ?? defaultTimeoutMs;
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
): { readonly modelId: string; readonly outputTokens: number } {
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
  if (profile !== undefined) {
    if (profile.provider !== mistralCompany || profile.modelId !== mistralLarge4ModelId) {
      throw invalidRequest(
        "The selected profile does not match the Mistral model.",
        "profile_mismatch",
      );
    }
    if (
      profile.runtime.thinking.mode !== "provider-default" ||
      profile.runtime.effort !== "provider-default"
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
    outputTokens = profile.runtime.maxOutputTokens;
  }

  if (!Number.isSafeInteger(outputTokens) || outputTokens < 1 || outputTokens > maxOutputTokens) {
    throw invalidRequest("The output-token budget is invalid.", "invalid_output_token_budget");
  }
  return { modelId: requestedData.data.modelId, outputTokens };
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
  return new ProviderAdapterError(mistralProvider, "invalid-response", message, {
    retryable: false,
    failureStage,
    diagnostics: [{ code, path: "response" }],
    ...(diagnosticCounts === undefined ? {} : { diagnosticCounts }),
  });
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

function canceledError(): ProviderAdapterError {
  return new ProviderAdapterError(
    mistralProvider,
    "cancelled",
    "The Mistral request was cancelled.",
    { retryable: false },
  );
}

function timeoutError(): ProviderAdapterError {
  return new ProviderAdapterError(mistralProvider, "timeout", "The Mistral request timed out.", {
    retryable: true,
    diagnostics: [{ code: "request_timeout", path: "request" }],
  });
}

/** Mistral error bodies are inspected for a category only; they are never copied. */
function errorBody(error: unknown): string {
  return isRecord(error) && typeof error.body === "string" ? error.body : "";
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
  if (status === undefined && name === "ResponseValidationError") return malformedResponse();
  if (status === undefined && name === "ConnectionError") {
    return new ProviderAdapterError(mistralProvider, "transient", "Unable to reach Mistral.", {
      retryable: true,
      diagnostics: [{ code: "connection_failed", path: "request" }],
    });
  }
  return normalizeProviderError(mistralProvider, error);
}

/**
 * Run one attempt under a deadline and the caller's abort signal.
 * The race also settles a transport that ignores the signal.
 */
async function withinDeadline<Value>(
  start: (signal: AbortSignal) => PromiseLike<Value>,
  options: { readonly externalSignal: AbortSignal | undefined; readonly timeoutMs: number },
): Promise<Value> {
  if (options.externalSignal?.aborted) throw canceledError();
  const controller = new AbortController();
  let timedOut = false;
  let rejectDeadline: (error: ProviderAdapterError) => void = () => undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    rejectDeadline = reject;
  });
  // The losing branch must never surface as an unhandled rejection.
  deadline.catch(() => undefined);
  const onExternalAbort = () => {
    controller.abort();
    rejectDeadline(canceledError());
  };
  options.externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
    rejectDeadline(timeoutError());
  }, options.timeoutMs);
  try {
    return await Promise.race([Promise.resolve(start(controller.signal)), deadline]);
  } catch (error) {
    throw timedOut ? timeoutError() : error;
  } finally {
    clearTimeout(timer);
    options.externalSignal?.removeEventListener("abort", onExternalAbort);
    controller.abort();
  }
}

function isExpectedServedModel(value: unknown, modelId: string): value is string {
  return typeof value === "string" && (value === modelId || value.startsWith(`${modelId}-`));
}

interface MistralCompletion {
  readonly text: string;
  readonly finishReason: string;
  readonly responseId: string | undefined;
  readonly usage: unknown;
}

function messageText(content: unknown): string {
  if (content === undefined || content === null) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) throw malformedResponse();
  let text = "";
  for (const chunk of content as unknown[]) {
    if (!isRecord(chunk)) throw malformedResponse();
    // Reasoning chunks are never stored or mixed into the answer.
    if (chunk.type === "thinking") continue;
    if ((chunk.type === undefined || chunk.type === "text") && typeof chunk.text === "string") {
      text += chunk.text;
      continue;
    }
    throw malformedResponse();
  }
  return text;
}

function readCompletion(response: unknown, modelId: string): MistralCompletion {
  if (!isRecord(response) || !Array.isArray(response.choices) || response.choices.length !== 1) {
    throw malformedResponse();
  }
  if (!isExpectedServedModel(response.model, modelId)) {
    throw failResponse(
      "Mistral returned a response from an unexpected model.",
      "unexpected_response_model",
    );
  }
  const choice: unknown = response.choices[0];
  if (!isRecord(choice) || typeof choice.finishReason !== "string") throw malformedResponse();
  const message = choice.message;
  if (message !== undefined && !isRecord(message)) throw malformedResponse();
  if (isRecord(message) && Array.isArray(message.toolCalls) && message.toolCalls.length > 0) {
    throw malformedResponse();
  }
  const text = isRecord(message) ? messageText(message.content) : "";
  if (Buffer.byteLength(text, "utf8") > maximumOutputBytes) {
    throw failResponse("Mistral returned an oversized structured response.", "output_too_large");
  }
  return {
    text,
    finishReason: choice.finishReason,
    responseId:
      typeof response.id === "string" && response.id.trim() !== "" ? response.id : undefined,
    usage: response.usage,
  };
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
  private readonly timeoutMs: number;

  constructor(client: MistralClient, options: MistralAdapterOptions) {
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
    assertDataExposureAllowed(mistralProvider, request.dataPolicy);
    const outputSchema = compileOutputSchema(request.outputSchema);
    let serializedInput: string;
    try {
      serializedInput = JSON.stringify(request.input);
    } catch {
      throw invalidRequest("The request input cannot be serialized as JSON.", "invalid_input_json");
    }

    const chatRequest: ChatCompletionRequest = {
      model: controls.modelId,
      messages: [
        { role: "system", content: request.systemPrompt },
        { role: "user", content: serializedInput },
      ],
      maxTokens: controls.outputTokens,
      n: 1,
      stream: false,
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
    return executeWithRetry(async () => {
      try {
        const raw = await withinDeadline(
          (signal) =>
            this.client.chat.complete(chatRequest, { signal, retries: { strategy: "none" } }),
          { externalSignal: request.signal, timeoutMs: this.timeoutMs },
        );
        const completion = readCompletion(raw, controls.modelId);
        if (completion.finishReason === "length") {
          throw failResponse(
            "Mistral reached the output-token limit before completing the structured response.",
            "output_token_limit_reached",
            "output-token-budget-exceeded",
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
      }
    }, this.retry);
  }
}

export function createMistralAdapter<
  Input extends JsonValue = JsonValue,
  Output extends JsonValue = JsonValue,
>(client: MistralClient, options: MistralAdapterOptions): MistralAdapter<Input, Output> {
  return new MistralAdapter<Input, Output>(client, options);
}
