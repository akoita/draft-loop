import type { ModelSelection } from "@draft-loop/domain";

import {
  type JsonObject,
  type ModelRequest,
  ProviderAdapterError,
  type ProviderErrorCode,
} from "./index.js";
import { AnthropicClaudeUserSessionAdapter, type UserSessionProbeOptions } from "./user-session.js";

/**
 * The bounded outcome of one synthetic author request.
 *
 * - `available`: the declared model answered the synthetic structured request.
 * - `model-unavailable`: the runtime reported the declared model as missing or failing.
 * - `api-error`: the runtime reported a transient or statusless provider API error.
 * - `timeout`: the synthetic request did not finish within the preflight timeout.
 * - `unavailable`: any other failure, such as authentication, quota, or a missing runtime.
 */
export type AuthorModelPreflightStatus =
  | "available"
  | "model-unavailable"
  | "api-error"
  | "timeout"
  | "unavailable";

/** A content-free preflight result: no prompts, responses, messages, or paths. */
export interface AuthorModelPreflightResult {
  readonly status: AuthorModelPreflightStatus;
  readonly errorCode: ProviderErrorCode | null;
  readonly diagnosticCodes: readonly string[];
}

export interface AuthorModelPreflightOptions extends UserSessionProbeOptions {
  /** The exact declared Anthropic author model to check. */
  readonly model: ModelSelection;
  /**
   * The author's output-token budget. Defaults to the newest author prompt
   * budget; pass the budget of the prompt version being checked to match it.
   */
  readonly maxOutputTokens?: number;
}

const defaultAuthorModelPreflightTimeoutMs = 60_000;
// Tracks the output budget of the newest author prompt version
// (`cli-author-v3` in the application) so the preflight runs the same runtime
// configuration, including extended thinking, as a real author call. Update it
// when a new author prompt version changes the budget; providers cannot import
// the application value. It is a ceiling; the synthetic reply uses only a few
// tokens.
const defaultAuthorModelPreflightMaxOutputTokens = 16_384;

const preflightSystemPrompt =
  'This is a synthetic availability check. Return exactly the JSON object {"ready": true} and nothing else.';
const preflightInput: JsonObject = Object.freeze({ check: "author-model-preflight" });
const preflightOutputSchema: JsonObject = Object.freeze({
  type: "object",
  properties: Object.freeze({ ready: Object.freeze({ type: "boolean" }) }),
  required: Object.freeze(["ready"]),
  additionalProperties: false,
});
const preflightDataPolicy = Object.freeze({
  allowTransmission: true,
  allowedCompanies: Object.freeze(["anthropic"] as const),
  sensitiveData: false,
  sensitiveDataAcknowledged: false,
});

function preflightRequest(
  model: ModelSelection,
  maxOutputTokens: number,
): ModelRequest<JsonObject> {
  return Object.freeze({
    contextSnapshotId: "author-model-preflight",
    model,
    systemPrompt: preflightSystemPrompt,
    input: preflightInput,
    outputSchema: preflightOutputSchema,
    outputName: "author_model_preflight",
    maxOutputTokens,
    dataPolicy: preflightDataPolicy,
  });
}

function uniqueDiagnosticCodes(error: ProviderAdapterError): readonly string[] {
  return [...new Set(error.diagnostics.map((diagnostic) => diagnostic.code))];
}

function classifyProviderError(error: ProviderAdapterError): AuthorModelPreflightResult {
  const diagnosticCodes = uniqueDiagnosticCodes(error);
  const failure = { errorCode: error.code, diagnosticCodes };
  if (error.code === "timeout") return { status: "timeout", ...failure };
  if (error.status === 404 || diagnosticCodes.includes("claude_terminal_reason_model_error")) {
    return { status: "model-unavailable", ...failure };
  }
  if (error.code === "transient" || diagnosticCodes.includes("claude_terminal_reason_api_error")) {
    return { status: "api-error", ...failure };
  }
  return { status: "unavailable", ...failure };
}

function isReady(output: unknown): boolean {
  return (
    typeof output === "object" &&
    output !== null &&
    !Array.isArray(output) &&
    (output as { readonly ready?: unknown }).ready === true
  );
}

/**
 * Send one fixed synthetic request, containing no candidate material, to the
 * declared Anthropic author model through the Claude user-session adapter.
 *
 * Unlike `probeAnthropicClaudeUserSession`, which only checks the login state,
 * this proves the declared model can answer a structured request. It never
 * throws and never returns provider response text or error messages.
 */
export async function preflightAnthropicClaudeAuthorModel(
  options: AuthorModelPreflightOptions,
): Promise<AuthorModelPreflightResult> {
  try {
    const adapter = new AnthropicClaudeUserSessionAdapter<JsonObject, JsonObject>({
      configuredModel: options.model,
      timeoutMs: options.timeoutMs ?? defaultAuthorModelPreflightTimeoutMs,
      ...(options.runner === undefined ? {} : { runner: options.runner }),
      ...(options.command === undefined ? {} : { command: options.command }),
      ...(options.maxOutputBytes === undefined ? {} : { maxOutputBytes: options.maxOutputBytes }),
      ...(options.environment === undefined ? {} : { environment: options.environment }),
    });
    const response = await adapter.execute(
      preflightRequest(
        options.model,
        options.maxOutputTokens ?? defaultAuthorModelPreflightMaxOutputTokens,
      ),
    );
    if (isReady(response.output)) {
      return { status: "available", errorCode: null, diagnosticCodes: [] };
    }
    return { status: "unavailable", errorCode: "invalid-response", diagnosticCodes: [] };
  } catch (error) {
    if (error instanceof ProviderAdapterError) return classifyProviderError(error);
    return { status: "unavailable", errorCode: null, diagnosticCodes: [] };
  }
}
