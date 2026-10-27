import { UnsafeUrlAddressError, type UrlFetcher } from "./pinned-url-fetcher.js";
import { maxUrlResponseBytes } from "./url-limits.js";

/*
 * The page fetcher's wire (#1837). The hosted API has no route to the internet, so it asks a
 * separate runtime, which holds no database and no secret, to make each hop of an approved page's
 * fetch. The fetcher answers the hop's status, content type, redirect target and bytes; the API's
 * URL intake still checks every redirect, bounds the page and extracts its text.
 */

/** The fetcher's one route: `POST` with `{"url": "https://..."}`. */
export const remoteFetchPath = "/v1/fetch";

/** Where the fetcher puts the fetched page's status and headers in its own answer. */
export const remoteFetchHeaders = {
  status: "draft-loop-upstream-status",
  contentType: "draft-loop-upstream-content-type",
  location: "draft-loop-upstream-location",
} as const;

/** One byte past what intake reads, so a larger page is still refused as too large. */
export const remoteFetchBodyLimit = maxUrlResponseBytes + 1;

/** Why the fetcher answered no page, in its error body's `code`. */
export type RemoteFetchRefusalCode =
  | "invalid-request"
  | "unsafe-url"
  | "fetch-timeout"
  | "fetch-failure";

const refusalCodes = new Set<string>([
  "invalid-request",
  "unsafe-url",
  "fetch-timeout",
  "fetch-failure",
] satisfies RemoteFetchRefusalCode[]);

/** The fetcher answered no page; `unsafe-url` is thrown as `UnsafeUrlAddressError` instead. */
export class RemoteFetchError extends Error {
  override readonly name = "RemoteFetchError";
  constructor(
    readonly code: RemoteFetchRefusalCode,
    readonly status: number,
  ) {
    super(`The page fetcher answered ${status} (${code}).`);
  }
}

export interface RemoteUrlFetcherOptions {
  /** The fetcher's address, such as `http://page-fetcher:8080` on the local stack. */
  readonly endpoint: string;
  /** The `authorization` header for each call, such as a Google identity token as a bearer. */
  readonly authorization?: () => Promise<string>;
  readonly fetch?: typeof fetch;
}

/** Statuses whose response has no body, which `Response` refuses to carry one for. */
const nullBodyStatuses = new Set([204, 205, 304]);

async function refusalCode(response: Response): Promise<RemoteFetchRefusalCode> {
  try {
    const body = (await response.json()) as { code?: unknown };
    if (typeof body.code === "string" && refusalCodes.has(body.code)) {
      return body.code as RemoteFetchRefusalCode;
    }
  } catch {
    // Not the fetcher's answer, such as a proxy's or Cloud Run's own refusal.
  }
  return "fetch-failure";
}

/**
 * A URL fetcher that makes each hop through the page fetcher. It never follows a redirect itself:
 * the hop's `location` comes back for intake to check, as with the pinned fetcher.
 */
export function createRemoteUrlFetcher(options: RemoteUrlFetcherOptions): UrlFetcher {
  const target = new URL(remoteFetchPath, options.endpoint).href;
  const request = options.fetch ?? fetch;
  return async (input, init) => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (options.authorization !== undefined) headers.authorization = await options.authorization();
    const response = await request(target, {
      method: "POST",
      headers,
      body: JSON.stringify({ url: input }),
      ...(init?.signal ? { signal: init.signal } : {}),
    });
    if (!response.ok) {
      const code = await refusalCode(response);
      if (code === "unsafe-url") throw new UnsafeUrlAddressError();
      throw new RemoteFetchError(code, response.status);
    }
    const status = Number(response.headers.get(remoteFetchHeaders.status));
    if (!Number.isInteger(status) || status < 200 || status > 599) {
      void response.body?.cancel().catch(() => undefined);
      throw new RemoteFetchError("fetch-failure", response.status);
    }
    const upstream = new Headers();
    const contentType = response.headers.get(remoteFetchHeaders.contentType);
    if (contentType !== null) upstream.set("content-type", contentType);
    const location = response.headers.get(remoteFetchHeaders.location);
    if (location !== null) upstream.set("location", location);
    if (nullBodyStatuses.has(status)) {
      void response.body?.cancel().catch(() => undefined);
      return new Response(null, { status, headers: upstream });
    }
    return new Response(response.body, { status, headers: upstream });
  };
}
