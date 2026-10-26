import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import type { RequestOptions } from "node:https";
import type { LookupFunction } from "node:net";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import { ingestUrl } from "./index.js";
import {
  createPinnedUrlFetcher,
  type PinnedUrlFetcherOptions,
  UnsafeUrlAddressError,
} from "./pinned-url-fetcher.js";

const publicAddress = "93.184.215.14";

interface Answer {
  readonly status: number;
  readonly headers?: Record<string, string>;
  readonly body?: string;
}

/** A stand-in for `https.request` that records each request and answers from a script. */
function scriptedRequest(answers: Record<string, Answer>) {
  const requests: { url: URL; options: RequestOptions }[] = [];
  const request: NonNullable<PinnedUrlFetcherOptions["request"]> = (url, options, onResponse) => {
    requests.push({ url, options });
    const outgoing = new EventEmitter() as EventEmitter & { end(): void };
    outgoing.end = () => {
      const answer = answers[url.href];
      if (answer === undefined) {
        outgoing.emit("error", new Error(`unexpected request: ${url.href}`));
        return;
      }
      const message = Readable.from([Buffer.from(answer.body ?? "")]) as unknown as IncomingMessage;
      message.statusCode = answer.status;
      message.headers = answer.headers ?? {};
      onResponse(message);
    };
    return outgoing;
  };
  return { request, requests };
}

function pinnedAddress(options: RequestOptions): Promise<{ address: string; family: number }> {
  const lookup = options.lookup as LookupFunction;
  return new Promise((resolve, reject) => {
    lookup("ignored.example.test", {}, (error, address, family) => {
      if (error) reject(error);
      else resolve({ address: address as string, family: family as number });
    });
  });
}

describe("the pinned URL fetcher", () => {
  it("resolves once and connects only to the address it checked, verifying TLS for the name", async () => {
    // A rebinding resolver: safe on the first answer, the metadata service after.
    const resolveHostname = vi
      .fn<(hostname: string) => Promise<readonly string[]>>()
      .mockResolvedValueOnce([publicAddress])
      .mockResolvedValue(["169.254.169.254"]);
    const { request, requests } = scriptedRequest({
      "https://jobs.example.test/role": {
        status: 200,
        headers: { "content-type": "text/html" },
        body: "<h1>Role</h1>",
      },
    });
    const fetcher = createPinnedUrlFetcher({ resolveHostname, request });

    const response = await fetcher("https://jobs.example.test/role");

    expect(resolveHostname).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html");
    expect(await response.text()).toBe("<h1>Role</h1>");
    const options = requests[0]?.options as RequestOptions;
    expect(options).toMatchObject({ agent: false, servername: "jobs.example.test" });
    expect(options.headers).toMatchObject({ "accept-encoding": "identity" });
    expect(await pinnedAddress(options)).toEqual({ address: publicAddress, family: 4 });
  });

  it("connects to nothing when any resolved address is unsafe", async () => {
    for (const addresses of [
      ["127.0.0.1"],
      ["169.254.169.254"],
      [publicAddress, "10.0.0.8"],
      ["::1"],
      ["fd00::1"],
      ["::ffff:127.0.0.1"],
      [],
    ]) {
      const { request, requests } = scriptedRequest({});
      const fetcher = createPinnedUrlFetcher({ resolveHostname: async () => addresses, request });
      await expect(fetcher("https://jobs.example.test/role")).rejects.toBeInstanceOf(
        UnsafeUrlAddressError,
      );
      expect(requests).toHaveLength(0);
    }
  });

  it("refuses plain http and unsafe literal hosts without resolving them", async () => {
    const resolveHostname = vi.fn(async () => [publicAddress]);
    const { request, requests } = scriptedRequest({});
    const fetcher = createPinnedUrlFetcher({ resolveHostname, request });
    for (const url of [
      "http://jobs.example.test/role",
      "https://127.0.0.1/role",
      "https://[::1]/role",
      // IPv4-mapped loopback, which the address check once let through.
      "https://[::ffff:7f00:1]/role",
      "https://localhost/role",
    ]) {
      await expect(fetcher(url)).rejects.toBeInstanceOf(UnsafeUrlAddressError);
    }
    expect(requests).toHaveLength(0);
  });

  it("returns a redirect without following it, and a bodiless status without a body", async () => {
    const { request, requests } = scriptedRequest({
      "https://jobs.example.test/old": {
        status: 302,
        headers: { location: "https://jobs.example.test/new" },
      },
      "https://jobs.example.test/empty": { status: 204 },
    });
    const fetcher = createPinnedUrlFetcher({
      resolveHostname: async () => [publicAddress],
      request,
    });

    const moved = await fetcher("https://jobs.example.test/old");
    const empty = await fetcher("https://jobs.example.test/empty");

    expect(moved.status).toBe(302);
    expect(moved.headers.get("location")).toBe("https://jobs.example.test/new");
    expect(empty.status).toBe(204);
    expect(empty.body).toBeNull();
    expect(requests).toHaveLength(2);
  });
});

describe("URL ingestion over the pinned fetcher", () => {
  it("reads a page, and refuses a redirect to a host that resolves to the metadata service", async () => {
    const { request } = scriptedRequest({
      "https://jobs.example.test/role": {
        status: 200,
        headers: { "content-type": "text/plain" },
        body: "Platform Engineer",
      },
      "https://jobs.example.test/moved": {
        status: 301,
        headers: { location: "https://internal.example.test/role" },
      },
    });
    const addresses: Record<string, readonly string[]> = {
      "jobs.example.test": [publicAddress],
      "internal.example.test": ["169.254.169.254"],
    };
    const fetcher = createPinnedUrlFetcher({
      resolveHostname: async (hostname) => addresses[hostname] ?? [],
      request,
    });

    const read = await ingestUrl("https://jobs.example.test/role", { approved: true, fetcher });
    const moved = await ingestUrl("https://jobs.example.test/moved", { approved: true, fetcher });

    expect(read.issues).toEqual([]);
    expect(read.source?.text).toContain("Platform Engineer");
    expect(moved.source).toBeNull();
    expect(moved.issues.map((issue) => issue.code)).toEqual(["unsafe-url"]);
  });

  it("refuses an IPv4-mapped loopback address before fetching", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const result = await ingestUrl("https://[::ffff:7f00:1]/role", { approved: true, fetcher });
    expect(result.issues.map((issue) => issue.code)).toEqual(["unsafe-url"]);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
