/**
 * The provider's own description of an error, kept beside the normalized code so that a failed
 * call can say which refusal it met (#1568). Only the `type` and `code` fields, the rate-limit
 * headers and Retry-After are read, as short tokens and numbers: the provider's message, request
 * and response bodies can quote the prompt.
 */
const safeTokenPattern = /^[a-z0-9_.-]{1,64}$/iu;

/** The value when it is a short token such as `invalid_api_key`; otherwise nothing. */
export function safeProviderErrorToken(value: unknown): string | undefined {
  return typeof value === "string" && safeTokenPattern.test(value) ? value : undefined;
}

/** Which of a provider's rate limits refused the call. */
export const providerRateLimits = ["requests", "tokens", "input-tokens", "output-tokens"] as const;

export type ProviderRateLimit = (typeof providerRateLimits)[number];

export function isProviderRateLimit(value: unknown): value is ProviderRateLimit {
  return typeof value === "string" && (providerRateLimits as readonly string[]).includes(value);
}

const maxRetryAfterSeconds = 86_400;

/** Whole seconds, from 0 to a day; anything else is dropped. */
export function safeRetryAfterSeconds(value: unknown): number | undefined {
  return Number.isInteger(value) &&
    (value as number) >= 0 &&
    (value as number) <= maxRetryAfterSeconds
    ? (value as number)
    : undefined;
}

export interface ProviderErrorIdentity {
  readonly providerErrorType?: string;
  readonly providerErrorCode?: string;
  /** On a 429, the limit whose remaining count the provider reported as 0. */
  readonly rateLimit?: ProviderRateLimit;
  /** The provider's Retry-After, in whole seconds, before any cap a retry applies. */
  readonly retryAfterSeconds?: number;
}

function header(headers: unknown, name: string): string | undefined {
  if (typeof headers !== "object" || headers === null) return undefined;
  const candidate = headers as { readonly get?: (name: string) => unknown };
  if (typeof candidate.get === "function") {
    try {
      const value = candidate.get(name);
      return typeof value === "string" ? value : undefined;
    } catch {
      return undefined;
    }
  }
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    if (key.toLowerCase() === name) return typeof value === "string" ? value : undefined;
  }
  return undefined;
}

/** The remaining-count headers per limit: OpenAI's first, then Anthropic's. */
const remainingHeaders: readonly (readonly [ProviderRateLimit, readonly string[]])[] = [
  ["requests", ["x-ratelimit-remaining-requests", "anthropic-ratelimit-requests-remaining"]],
  ["tokens", ["x-ratelimit-remaining-tokens", "anthropic-ratelimit-tokens-remaining"]],
  ["input-tokens", ["anthropic-ratelimit-input-tokens-remaining"]],
  ["output-tokens", ["anthropic-ratelimit-output-tokens-remaining"]],
];

function exhaustedLimit(headers: unknown): ProviderRateLimit | undefined {
  for (const [limit, names] of remainingHeaders) {
    if (names.some((name) => header(headers, name)?.trim() === "0")) return limit;
  }
  return undefined;
}

function retryAfterSeconds(headers: unknown): number | undefined {
  const milliseconds = Number(header(headers, "retry-after-ms")?.trim() ?? Number.NaN);
  if (Number.isFinite(milliseconds) && milliseconds >= 0) {
    return safeRetryAfterSeconds(Math.ceil(milliseconds / 1_000));
  }
  const seconds = Number(header(headers, "retry-after")?.trim() ?? Number.NaN);
  return Number.isFinite(seconds) && seconds >= 0
    ? safeRetryAfterSeconds(Math.ceil(seconds))
    : undefined;
}

/**
 * What the Anthropic and OpenAI SDKs say about an API error, as tokens and numbers: the `type`
 * and `code`, such as `rate_limit_error`, or `rate_limit_exceeded` and `insufficient_quota`; on a
 * 429, which limit ran out; and the Retry-After seconds.
 */
export function providerErrorIdentity(error: unknown): ProviderErrorIdentity {
  if (typeof error !== "object" || error === null) return {};
  const { type, code, status, headers } = error as {
    readonly type?: unknown;
    readonly code?: unknown;
    readonly status?: unknown;
    readonly headers?: unknown;
  };
  const providerErrorType = safeProviderErrorToken(type);
  const providerErrorCode = safeProviderErrorToken(code);
  const rateLimit = status === 429 ? exhaustedLimit(headers) : undefined;
  const retryAfter = retryAfterSeconds(headers);
  return {
    ...(providerErrorType === undefined ? {} : { providerErrorType }),
    ...(providerErrorCode === undefined ? {} : { providerErrorCode }),
    ...(rateLimit === undefined ? {} : { rateLimit }),
    ...(retryAfter === undefined ? {} : { retryAfterSeconds: retryAfter }),
  };
}
