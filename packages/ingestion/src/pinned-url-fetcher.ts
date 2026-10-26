import { lookup } from "node:dns/promises";
import type { IncomingMessage } from "node:http";
import { request as httpsRequest, type RequestOptions } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { Readable } from "node:stream";

import { unsafeLiteralHostname } from "./network-address.js";

/** Fetches one URL without following redirects; ingestion checks each hop itself. */
export type UrlFetcher = (input: string, init?: RequestInit) => Promise<Response>;
/** Resolves a hostname to every address it currently has. */
export type UrlHostnameResolver = (hostname: string) => Promise<readonly string[]>;

/** The host resolved to an address a fetch must not reach, so nothing was connected. */
export class UnsafeUrlAddressError extends Error {
  constructor() {
    super("The URL resolves to an address DraftLoop does not fetch from.");
    this.name = "UnsafeUrlAddressError";
  }
}

export interface PinnedUrlFetcherOptions {
  /** Override DNS resolution in tests or a host-owned network policy. */
  readonly resolveHostname?: UrlHostnameResolver;
  /** Opens the request; tests pass a stand-in. Defaults to `node:https`. */
  readonly request?: (
    url: URL,
    options: RequestOptions,
    onResponse: (response: IncomingMessage) => void,
  ) => { on(event: "error", listener: (error: Error) => void): unknown; end(): unknown };
}

export const defaultUrlHostnameResolver: UrlHostnameResolver = async (hostname) =>
  (await lookup(hostname, { all: true })).map((address) => address.address);

/** Statuses whose response has no body, which `Response` refuses to carry one for. */
const nullBodyStatuses = new Set([101, 103, 204, 205, 304]);

function responseHeaders(message: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(message.headers)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) headers.append(name, item);
  }
  return headers;
}

/**
 * A fetcher that connects only to an address it checked (#1811). It resolves the host once,
 * refuses when any address is loopback, private, link-local or otherwise unsafe, and then opens
 * the connection to the first checked address while TLS still verifies the hostname. A DNS answer
 * that changes between the check and the connection, as in DNS rebinding, cannot redirect it to a
 * metadata service or an internal host. Redirects are returned, not followed, so each hop goes
 * through the same check.
 */
export function createPinnedUrlFetcher(options: PinnedUrlFetcherOptions = {}): UrlFetcher {
  const resolve = options.resolveHostname ?? defaultUrlHostnameResolver;
  const request = options.request ?? httpsRequest;
  return async (input, init) => {
    const url = new URL(input);
    if (url.protocol !== "https:") throw new UnsafeUrlAddressError();
    const hostname = url.hostname.replace(/^\[|\]$/gu, "");
    const literal = isIP(hostname) !== 0;
    const addresses = literal ? [hostname] : await resolve(hostname);
    const address = addresses[0];
    if (
      address === undefined ||
      unsafeLiteralHostname(hostname) ||
      addresses.some((candidate) => isIP(candidate) === 0 || unsafeLiteralHostname(candidate))
    ) {
      throw new UnsafeUrlAddressError();
    }
    const family = isIP(address);
    const pinned: LookupFunction = (_name, lookupOptions, callback) => {
      if (lookupOptions.all === true) {
        (callback as (error: null, addresses: { address: string; family: number }[]) => void)(
          null,
          [{ address, family }],
        );
      } else {
        callback(null, address, family);
      }
    };
    return await new Promise<Response>((resolveResponse, reject) => {
      const outgoing = request(
        url,
        {
          method: "GET",
          // A fresh connection each time, so no pooled socket outlives the address check.
          agent: false,
          lookup: pinned,
          ...(literal ? {} : { servername: hostname }),
          headers: {
            accept: "text/html,application/xhtml+xml,text/plain,text/markdown;q=0.9,*/*;q=0.1",
            // The body is read as is, so ask for it uncompressed.
            "accept-encoding": "identity",
            "user-agent": "DraftLoop",
          },
          ...(init?.signal ? { signal: init.signal } : {}),
        },
        (message) => {
          const status = message.statusCode ?? 0;
          try {
            if (nullBodyStatuses.has(status)) {
              message.resume();
              resolveResponse(new Response(null, { status, headers: responseHeaders(message) }));
              return;
            }
            resolveResponse(
              new Response(Readable.toWeb(message) as ReadableStream<Uint8Array>, {
                status,
                headers: responseHeaders(message),
              }),
            );
          } catch (error) {
            message.destroy();
            reject(error);
          }
        },
      );
      outgoing.on("error", reject);
      outgoing.end();
    });
  };
}
