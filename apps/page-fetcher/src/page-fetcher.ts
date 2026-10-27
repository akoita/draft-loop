import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import {
  createPinnedUrlFetcher,
  UnsafeUrlAddressError,
  type UrlFetcher,
} from "@draft-loop/ingestion";
import {
  type RemoteFetchRefusalCode,
  remoteFetchBodyLimit,
  remoteFetchHeaders,
  remoteFetchPath,
} from "@draft-loop/ingestion/remote-url-fetcher";

/** One fetch, as the fetcher logs it: the host only, never the path, the query or the page. */
export interface PageFetchLogEntry {
  readonly host: string;
  readonly outcome: "fetched" | RemoteFetchRefusalCode;
  /** The page's status, when it answered. */
  readonly status?: number;
  readonly durationMs: number;
}

export interface PageFetcherOptions {
  /** Makes each hop; the pinned fetcher, which connects only to an address it checked, by default. */
  readonly fetcher?: UrlFetcher;
  /** How long one hop may take, its body included. */
  readonly timeoutMs?: number;
  readonly log?: (entry: PageFetchLogEntry) => void;
}

const maxRequestBytes = 8 * 1024;
const defaultTimeoutMs = 15_000;

class RequestTooLargeError extends Error {}

function refuse(response: ServerResponse, status: number, code: RemoteFetchRefusalCode): void {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify({ code }));
}

async function readRequest(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).byteLength;
    if (size > maxRequestBytes) throw new RequestTooLargeError();
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** The address to fetch: an https URL with no credentials, or undefined. */
function requestedUrl(text: string): URL | undefined {
  try {
    const body = JSON.parse(text) as { url?: unknown };
    if (typeof body.url !== "string") return undefined;
    const url = new URL(body.url);
    if (url.protocol !== "https:" || url.username !== "" || url.password !== "") return undefined;
    return url;
  } catch {
    return undefined;
  }
}

/** Reads at most `limit` bytes, then stops: the caller refuses a page that reached the limit. */
async function readBounded(
  body: ReadableStream<Uint8Array> | null,
  limit: number,
): Promise<Buffer> {
  if (body === null) return Buffer.alloc(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      const room = limit - size;
      const chunk = value.byteLength > room ? value.subarray(0, room) : value;
      chunks.push(chunk);
      size += chunk.byteLength;
    }
  } finally {
    void reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks);
}

async function fetchPage(
  url: URL,
  response: ServerResponse,
  fetcher: UrlFetcher,
  timeoutMs: number,
): Promise<{ outcome: PageFetchLogEntry["outcome"]; status?: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const page = await fetcher(url.href, { redirect: "manual", signal: controller.signal });
    if (page.status < 200 || page.status > 599) {
      void page.body?.cancel().catch(() => undefined);
      refuse(response, 502, "fetch-failure");
      return { outcome: "fetch-failure", status: page.status };
    }
    const bytes = await readBounded(page.body, remoteFetchBodyLimit);
    const headers: Record<string, string> = {
      "content-type": "application/octet-stream",
      "cache-control": "no-store",
      [remoteFetchHeaders.status]: String(page.status),
    };
    const contentType = page.headers.get("content-type");
    if (contentType !== null) headers[remoteFetchHeaders.contentType] = contentType;
    const location = page.headers.get("location");
    if (location !== null) headers[remoteFetchHeaders.location] = location;
    response.writeHead(200, headers);
    response.end(bytes);
    return { outcome: "fetched", status: page.status };
  } catch (error) {
    const code: RemoteFetchRefusalCode =
      error instanceof UnsafeUrlAddressError
        ? "unsafe-url"
        : controller.signal.aborted
          ? "fetch-timeout"
          : "fetch-failure";
    refuse(response, code === "unsafe-url" ? 422 : code === "fetch-timeout" ? 504 : 502, code);
    return { outcome: code };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The page fetcher (#1837): the only hosted runtime that reaches the internet on a person's
 * behalf. It holds no database, no secret and no candidate material, makes one hop of an approved
 * job page's fetch per request through the pinned fetcher, and answers the hop's status, headers
 * and at most one byte past intake's limit. Who may call it is Cloud Run's IAM check, not its own.
 */
export function createPageFetcherServer(options: PageFetcherOptions = {}): Server {
  const fetcher = options.fetcher ?? createPinnedUrlFetcher();
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const path = new URL(request.url ?? "/", "http://page-fetcher").pathname;
    if (request.method === "GET" && path === "/healthz") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("ok");
      return;
    }
    if (path !== remoteFetchPath) {
      refuse(response, 404, "invalid-request");
      return;
    }
    if (request.method !== "POST") {
      refuse(response, 405, "invalid-request");
      return;
    }
    let url: URL | undefined;
    try {
      url = requestedUrl(await readRequest(request));
    } catch (error) {
      refuse(response, error instanceof RequestTooLargeError ? 413 : 400, "invalid-request");
      return;
    }
    if (url === undefined) {
      refuse(response, 400, "invalid-request");
      return;
    }
    const started = Date.now();
    const result = await fetchPage(url, response, fetcher, timeoutMs);
    options.log?.({ host: url.hostname, ...result, durationMs: Date.now() - started });
  };
  return createServer((request, response) => {
    void handle(request, response).catch(() => {
      if (response.headersSent) response.destroy();
      else refuse(response, 500, "fetch-failure");
    });
  });
}
