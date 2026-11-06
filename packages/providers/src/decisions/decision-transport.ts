import { DecisionModelError, type DecisionVendor } from "./decision-model.js";

/** The `fetch` the adapters call; a test passes a scripted one. */
export type DecisionFetch = (input: string, init: RequestInit) => Promise<Response>;

export const defaultDecisionTimeoutMs = 15_000;
const maximumRetryAfterMs = 60_000;

export interface DecisionPost {
  readonly vendor: DecisionVendor;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
  readonly fetch: DecisionFetch;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal | undefined;
  /** The response header that carries the vendor's request id. */
  readonly requestIdHeader: string;
}

export interface DecisionPostResult {
  readonly json: unknown;
  readonly requestId: string | null;
}

function retryAfterMs(response: Response): number | null {
  const header = response.headers.get("retry-after");
  if (header === null) return null;
  const seconds = Number(header);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.min(Math.round(seconds * 1000), maximumRetryAfterMs);
}

function errorForStatus(
  vendor: DecisionVendor,
  status: number,
  requestId: string | null,
  retryAfter: number | null,
): DecisionModelError {
  const options = { status, requestId, retryAfterMs: retryAfter };
  if (status === 401) {
    return new DecisionModelError(
      vendor,
      "authentication",
      "The decision vendor refused the credentials.",
      options,
    );
  }
  if (status === 403) {
    return new DecisionModelError(
      vendor,
      "permission",
      "The decision vendor refused access to this model.",
      options,
    );
  }
  if (status === 429) {
    return new DecisionModelError(
      vendor,
      "rate-limit",
      "The decision vendor's rate limit was reached.",
      {
        ...options,
        retryable: true,
      },
    );
  }
  if (status === 400 || status === 404 || status === 422) {
    return new DecisionModelError(
      vendor,
      "invalid-request",
      "The decision vendor rejected the request.",
      options,
    );
  }
  if (status >= 500) {
    return new DecisionModelError(vendor, "transient", "The decision vendor failed to answer.", {
      ...options,
      retryable: true,
    });
  }
  return new DecisionModelError(vendor, "unknown", "The decision call failed.", options);
}

/**
 * One JSON POST with a timeout. Errors carry the status and request id only: a response body is
 * never read into an error, since it may echo the input.
 */
export async function postDecisionRequest(post: DecisionPost): Promise<DecisionPostResult> {
  const cancelled = (): boolean => post.signal?.aborted === true;
  if (cancelled()) {
    throw new DecisionModelError(post.vendor, "cancelled", "The decision call was cancelled.");
  }
  const timeout = AbortSignal.timeout(post.timeoutMs);
  const signal = post.signal === undefined ? timeout : AbortSignal.any([post.signal, timeout]);
  let response: Response;
  try {
    response = await post.fetch(post.url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", ...post.headers },
      body: JSON.stringify(post.body),
      signal,
    });
  } catch {
    if (cancelled()) {
      throw new DecisionModelError(post.vendor, "cancelled", "The decision call was cancelled.");
    }
    if (timeout.aborted) {
      throw new DecisionModelError(post.vendor, "timeout", "The decision call timed out.", {
        retryable: true,
      });
    }
    throw new DecisionModelError(
      post.vendor,
      "transient",
      "The decision vendor could not be reached.",
      {
        retryable: true,
      },
    );
  }
  const requestId = response.headers.get(post.requestIdHeader);
  if (!response.ok) {
    throw errorForStatus(post.vendor, response.status, requestId, retryAfterMs(response));
  }
  try {
    return { json: await response.json(), requestId };
  } catch {
    throw new DecisionModelError(
      post.vendor,
      "invalid-response",
      "The decision response is not JSON.",
      {
        status: response.status,
        requestId,
      },
    );
  }
}
