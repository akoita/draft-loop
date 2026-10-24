/**
 * Checking a hosted API key before a run, without paying for one.
 *
 * A mistyped key used to pass every setup screen and fail only at the critic,
 * after the author step had already been billed. This check asks the
 * provider's model lookup endpoint instead: a GET that is not billed, carries
 * no candidate material, and answers both questions a run needs answered —
 * does the provider accept this key, and can the key reach this model.
 *
 * The key goes only into the request header. It is never part of the result,
 * an error, or a diagnostic, and the answer keeps at most one short provider
 * error token, never the provider's message.
 */

import { anthropicApiBaseUrl, anthropicApiVersion, openaiApiBaseUrl } from "./discovery.js";

/** The hosted providers whose API key can be checked. */
export type ApiKeyCheckProvider = "anthropic" | "openai";

/**
 * - `works`: the key was accepted and, when a model was named, the model is available to it.
 * - `rejected`: the provider refused the key itself (401).
 * - `no-model-access`: the key works but cannot reach the named model (403 or 404).
 * - `limited`: a quota or rate limit answered instead (429).
 * - `unreachable`: no answer could be read: a network error, a timeout or an unexpected status.
 *   It never means the key is wrong.
 */
export const apiKeyCheckOutcomes = [
  "works",
  "rejected",
  "no-model-access",
  "limited",
  "unreachable",
] as const;
export type ApiKeyCheckOutcome = (typeof apiKeyCheckOutcomes)[number];

export interface ApiKeyCheckResult {
  readonly provider: ApiKeyCheckProvider;
  readonly outcome: ApiKeyCheckOutcome;
  /**
   * The provider's own error token for a limit, such as `insufficient_quota` or
   * `rate_limit_exceeded`, when it is one short safe word; otherwise null.
   */
  readonly providerCode: string | null;
}

export interface ApiKeyCheckInput {
  readonly provider: ApiKeyCheckProvider;
  readonly apiKey: string;
  /** The model a run would use with the key. Absent, only the key itself is checked. */
  readonly model?: string;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

/** How long a check may take before it is reported as not checked. */
export const defaultApiKeyCheckTimeoutMs = 10_000;

/** The most of an error body that is read to find the provider's token. */
const maximumErrorBodyCharacters = 16_384;

/** A provider error token worth repeating: lowercase words joined by underscores. */
const providerCodePattern = /^[a-z][a-z0-9_]{0,47}$/u;

function requestFor(input: ApiKeyCheckInput): {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
} {
  const model = input.model?.trim();
  if (input.provider === "anthropic") {
    return {
      url:
        model === undefined || model === ""
          ? `${anthropicApiBaseUrl}/models?limit=1`
          : `${anthropicApiBaseUrl}/models/${encodeURIComponent(model)}`,
      headers: { "x-api-key": input.apiKey, "anthropic-version": anthropicApiVersion },
    };
  }
  return {
    url:
      model === undefined || model === ""
        ? `${openaiApiBaseUrl}/models`
        : `${openaiApiBaseUrl}/models/${encodeURIComponent(model)}`,
    headers: { authorization: `Bearer ${input.apiKey}` },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads the provider's error token from a limit response: OpenAI's `error.code`
 * (`insufficient_quota`, `rate_limit_exceeded`) or Anthropic's `error.type`
 * (`rate_limit_error`). Anything longer or stranger is dropped.
 */
async function limitCode(response: Response): Promise<string | null> {
  let body: string;
  try {
    body = await response.text();
  } catch {
    return null;
  }
  if (body.length > maximumErrorBodyCharacters) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    return null;
  }
  const error = isRecord(parsed) ? parsed.error : undefined;
  if (!isRecord(error)) return null;
  for (const candidate of [error.code, error.type]) {
    if (typeof candidate === "string" && providerCodePattern.test(candidate)) return candidate;
  }
  return null;
}

function outcomeFor(status: number): ApiKeyCheckOutcome {
  if (status >= 200 && status < 300) return "works";
  if (status === 401) return "rejected";
  if (status === 403 || status === 404) return "no-model-access";
  if (status === 429) return "limited";
  return "unreachable";
}

/**
 * Asks the provider whether it accepts the key, and whether the key can reach
 * the model when one is named. One GET to the model lookup or listing
 * endpoint; no generation request is ever made.
 */
export async function checkProviderApiKey(input: ApiKeyCheckInput): Promise<ApiKeyCheckResult> {
  const { provider } = input;
  const notChecked: ApiKeyCheckResult = { provider, outcome: "unreachable", providerCode: null };
  if (input.apiKey.trim() === "") return { provider, outcome: "rejected", providerCode: null };
  const { url, headers } = requestFor({ ...input, apiKey: input.apiKey.trim() });
  const fetchImpl = input.fetch ?? globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("The provider did not answer in time.")),
    input.timeoutMs ?? defaultApiKeyCheckTimeoutMs,
  );
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { ...headers, accept: "application/json" },
      signal: controller.signal,
    });
    const outcome = outcomeFor(response.status);
    if (outcome === "limited") {
      return { provider, outcome, providerCode: await limitCode(response) };
    }
    // Nothing else in the body is needed, so it is not read.
    await response.body?.cancel().catch(() => undefined);
    return { provider, outcome, providerCode: null };
  } catch {
    // A network failure or timeout says nothing about the key.
    return notChecked;
  } finally {
    clearTimeout(timer);
  }
}
