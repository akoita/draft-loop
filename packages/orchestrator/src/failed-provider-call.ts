/**
 * Which provider call a step's failure came from (#1568): its role, company, model and route, the
 * HTTP status, the provider's own error `type` and `code`, and for a rate limit which limit ran out
 * and the Retry-After seconds. Every field is an identity, a short token or a number, never the
 * provider's message or a body, so a log line and the API can carry it (ADR 0011, D16).
 */
export interface FailedProviderCall {
  readonly role: "author" | "critic";
  readonly company: string;
  readonly model: string;
  /** The endpoint the call went to, such as `vertex-ai`; absent when the adapter named none. */
  readonly route?: string;
  readonly status?: number;
  readonly providerErrorType?: string;
  readonly providerErrorCode?: string;
  /** On a 429, the limit the provider reported as used up: requests, tokens, input or output tokens. */
  readonly rateLimit?: string;
  /** The provider's Retry-After in whole seconds. */
  readonly retryAfterSeconds?: number;
}

const routePattern = /^[a-z0-9-]{1,32}$/u;
const tokenPattern = /^[a-z0-9_.-]{1,64}$/iu;
const rateLimits: ReadonlySet<unknown> = new Set([
  "requests",
  "tokens",
  "input-tokens",
  "output-tokens",
]);

function matching(value: unknown, pattern: RegExp): string | undefined {
  return typeof value === "string" && pattern.test(value) ? value : undefined;
}

function httpStatus(value: unknown): number | undefined {
  return Number.isInteger(value) && (value as number) >= 100 && (value as number) <= 599
    ? (value as number)
    : undefined;
}

function retryAfterSeconds(value: unknown): number | undefined {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 86_400
    ? (value as number)
    : undefined;
}

/**
 * The failed call as a provider adapter's error describes it. The role, company and model are the
 * ones the run's failure already names; the rest is read only when it is a safe token.
 */
export function failedProviderCall(
  error: unknown,
  failure: {
    readonly step: string;
    readonly provider: string;
    readonly modelId: string;
  },
): FailedProviderCall {
  const candidate =
    typeof error === "object" && error !== null
      ? (error as {
          readonly route?: unknown;
          readonly status?: unknown;
          readonly providerErrorType?: unknown;
          readonly providerErrorCode?: unknown;
          readonly rateLimit?: unknown;
          readonly retryAfterSeconds?: unknown;
        })
      : {};
  const route = matching(candidate.route, routePattern);
  const status = httpStatus(candidate.status);
  const providerErrorType = matching(candidate.providerErrorType, tokenPattern);
  const providerErrorCode = matching(candidate.providerErrorCode, tokenPattern);
  const rateLimit = rateLimits.has(candidate.rateLimit)
    ? (candidate.rateLimit as string)
    : undefined;
  const retryAfter = retryAfterSeconds(candidate.retryAfterSeconds);
  return {
    role: failure.step === "critic" ? "critic" : "author",
    company: failure.provider,
    model: failure.modelId,
    ...(route === undefined ? {} : { route }),
    ...(status === undefined ? {} : { status }),
    ...(providerErrorType === undefined ? {} : { providerErrorType }),
    ...(providerErrorCode === undefined ? {} : { providerErrorCode }),
    ...(rateLimit === undefined ? {} : { rateLimit }),
    ...(retryAfter === undefined ? {} : { retryAfterSeconds: retryAfter }),
  };
}
