import { createHash } from "node:crypto";
import type { ModelSelection } from "@draft-loop/domain";
import { modelSelectionSchema } from "@draft-loop/schemas";
import OpenAI from "openai";
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
} from "openai/resources/chat/completions";
import { z } from "zod";
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
const maxSupportedTimeoutMs = 2_147_483_647;
const defaultMaxOutputTokens = 4096;
const maxOutputTokens = 131_072;

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
        parameters: ChatCompletionCreateParamsNonStreaming,
        options?: DeepInfraGLMRequestOptions,
      ): PromiseLike<ChatCompletion>;
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
): ProviderAdapterError {
  return new ProviderAdapterError(deepInfraGLMProvider, "invalid-response", message, {
    retryable: false,
    failureStage,
    diagnostics: [{ code, path: "response" }],
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
    throw failResponse(
      "DeepInfra output did not match the requested schema.",
      "output_schema_mismatch",
      "response-schema-validation",
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

    const parameters: ChatCompletionCreateParamsNonStreaming = {
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
      ...(controls.effort === undefined ? {} : { reasoning_effort: controls.effort }),
    };

    const startedAt = Date.now();
    request.onProgress?.({ stage: "started", elapsedMs: 0 });
    return executeWithRetry(async () => {
      if (request.signal?.aborted) throw canceledError();
      try {
        const response = await this.client.chat.completions.create(parameters, {
          maxRetries: 0,
          timeout: this.timeoutMs,
          ...(request.signal === undefined ? {} : { signal: request.signal }),
        });
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
