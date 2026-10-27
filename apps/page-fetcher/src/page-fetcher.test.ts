import type { AddressInfo } from "node:net";

import { ingestUrl, UnsafeUrlAddressError, type UrlFetcher } from "@draft-loop/ingestion";
import {
  createRemoteUrlFetcher,
  RemoteFetchError,
  remoteFetchBodyLimit,
} from "@draft-loop/ingestion/remote-url-fetcher";
import { afterEach, describe, expect, it } from "vitest";

import { createPageFetcherServer, type PageFetchLogEntry } from "./page-fetcher.js";

const servers: { close: () => void }[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

async function start(
  fetcher?: UrlFetcher,
  timeoutMs?: number,
): Promise<{ endpoint: string; logs: PageFetchLogEntry[] }> {
  const logs: PageFetchLogEntry[] = [];
  const server = createPageFetcherServer({
    ...(fetcher === undefined ? {} : { fetcher }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    log: (entry) => logs.push(entry),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  const { port } = server.address() as AddressInfo;
  return { endpoint: `http://127.0.0.1:${port}`, logs };
}

function post(endpoint: string, body: string): Promise<Response> {
  return fetch(`${endpoint}/v1/fetch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

const jobPage =
  "<html><body><h1>Platform engineer</h1><p>Run the build system and its tests.</p></body></html>";

describe("page fetcher", () => {
  it("answers its health check", async () => {
    const { endpoint } = await start(async () => new Response("unused"));
    const response = await fetch(`${endpoint}/healthz`);
    expect(response.status).toBe(200);
  });

  it("makes one hop and answers its status, headers and bytes, logging the host only", async () => {
    const calls: { url: string; redirect: RequestRedirect | undefined }[] = [];
    const { endpoint, logs } = await start(async (url, init) => {
      calls.push({ url, redirect: init?.redirect });
      return new Response(jobPage, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8", "set-cookie": "a=b" },
      });
    });
    const response = await post(
      endpoint,
      JSON.stringify({ url: "https://jobs.example.test/role/42?ref=private" }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("draft-loop-upstream-status")).toBe("200");
    expect(response.headers.get("draft-loop-upstream-content-type")).toBe(
      "text/html; charset=utf-8",
    );
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.text()).toBe(jobPage);
    expect(calls).toEqual([
      { url: "https://jobs.example.test/role/42?ref=private", redirect: "manual" },
    ]);
    expect(logs).toEqual([
      {
        host: "jobs.example.test",
        outcome: "fetched",
        status: 200,
        durationMs: expect.any(Number),
      },
    ]);
    expect(JSON.stringify(logs)).not.toContain("role/42");
  });

  it("returns a redirect for the caller to check instead of following it", async () => {
    const { endpoint } = await start(
      async () =>
        new Response(null, { status: 302, headers: { location: "https://other.example.test/" } }),
    );
    const response = await post(endpoint, JSON.stringify({ url: "https://jobs.example.test/" }));
    expect(response.headers.get("draft-loop-upstream-status")).toBe("302");
    expect(response.headers.get("draft-loop-upstream-location")).toBe(
      "https://other.example.test/",
    );
  });

  it("stops one byte past intake's limit", async () => {
    const { endpoint } = await start(
      async () => new Response(new Uint8Array(remoteFetchBodyLimit + 4096), { status: 200 }),
    );
    const response = await post(endpoint, JSON.stringify({ url: "https://jobs.example.test/" }));
    expect((await response.arrayBuffer()).byteLength).toBe(remoteFetchBodyLimit);
  });

  it.each([
    ["an http address", JSON.stringify({ url: "http://jobs.example.test/" })],
    ["an address with credentials", JSON.stringify({ url: "https://a:b@jobs.example.test/" })],
    ["no address", JSON.stringify({})],
    ["a body that is not JSON", "url=https://jobs.example.test/"],
  ])("refuses %s without fetching", async (_label, body) => {
    let fetched = false;
    const { endpoint } = await start(async () => {
      fetched = true;
      return new Response("");
    });
    const response = await post(endpoint, body);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ code: "invalid-request" });
    expect(fetched).toBe(false);
  });

  it("refuses a request body over 8 KB and any other route or method", async () => {
    const { endpoint } = await start(async () => new Response(""));
    const large = await post(
      endpoint,
      JSON.stringify({ url: `https://jobs.example.test/${"a".repeat(9000)}` }),
    );
    expect(large.status).toBe(413);
    expect((await fetch(`${endpoint}/v1/fetch`)).status).toBe(405);
    expect((await fetch(`${endpoint}/v1/other`, { method: "POST" })).status).toBe(404);
  });

  it("refuses a private address with the default pinned fetcher", async () => {
    const { endpoint, logs } = await start();
    const response = await post(endpoint, JSON.stringify({ url: "https://169.254.169.254/" }));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ code: "unsafe-url" });
    expect(logs[0]?.outcome).toBe("unsafe-url");
  });

  it("answers a timeout and a failure with their codes", async () => {
    const hanging = await start(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
      20,
    );
    const timedOut = await post(
      hanging.endpoint,
      JSON.stringify({ url: "https://jobs.example.test/" }),
    );
    expect(timedOut.status).toBe(504);
    expect(await timedOut.json()).toEqual({ code: "fetch-timeout" });

    const failing = await start(async () => {
      throw new Error("connection reset");
    });
    const failed = await post(
      failing.endpoint,
      JSON.stringify({ url: "https://jobs.example.test/" }),
    );
    expect(failed.status).toBe(502);
    expect(await failed.json()).toEqual({ code: "fetch-failure" });
  });
});

describe("intake through the page fetcher", () => {
  it("reads a page across a redirect, checking each hop", async () => {
    const pages: Record<string, () => Response> = {
      "https://jobs.example.test/apply": () =>
        new Response(null, { status: 301, headers: { location: "/role/42" } }),
      "https://jobs.example.test/role/42": () =>
        new Response(jobPage, { status: 200, headers: { "content-type": "text/html" } }),
    };
    const { endpoint } = await start(
      async (url) => pages[url]?.() ?? new Response("", { status: 404 }),
    );
    const result = await ingestUrl("https://jobs.example.test/apply", {
      approved: true,
      approval: true,
      fetcher: createRemoteUrlFetcher({ endpoint }),
    });
    expect(result.issues).toEqual([]);
    expect(result.source?.text).toContain("Run the build system and its tests.");
    expect(result.source?.url?.finalUrl).toBe("https://jobs.example.test/role/42");
  });

  it("refuses a redirect to a private address before asking the fetcher for it", async () => {
    const asked: string[] = [];
    const { endpoint } = await start(async (url) => {
      asked.push(url);
      return new Response(null, { status: 302, headers: { location: "https://10.0.0.5/" } });
    });
    const result = await ingestUrl("https://jobs.example.test/", {
      approved: true,
      approval: true,
      fetcher: createRemoteUrlFetcher({ endpoint }),
    });
    expect(result.issues.map(({ code }) => code)).toEqual(["unsafe-url"]);
    expect(asked).toEqual(["https://jobs.example.test/"]);
  });

  it("refuses a page over intake's limit as too large", async () => {
    const { endpoint } = await start(
      async () =>
        new Response(new Uint8Array(remoteFetchBodyLimit + 10), {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
    );
    const result = await ingestUrl("https://jobs.example.test/", {
      approved: true,
      approval: true,
      fetcher: createRemoteUrlFetcher({ endpoint }),
    });
    expect(result.issues.map(({ code }) => code)).toEqual(["response-too-large"]);
  });

  it("reports the fetcher's timeout as intake's", async () => {
    const result = await ingestUrl("https://jobs.example.test/", {
      approved: true,
      approval: true,
      fetcher: createRemoteUrlFetcher({
        endpoint: "http://page-fetcher:8080",
        fetch: async () => Response.json({ code: "fetch-timeout" }, { status: 504 }),
      }),
    });
    expect(result.issues.map(({ code }) => code)).toEqual(["fetch-timeout"]);
  });

  it("sends the authorization it is given and maps the fetcher's refusals", async () => {
    const seen: (string | null)[] = [];
    const unsafe = createRemoteUrlFetcher({
      endpoint: "https://page-fetcher.example.test",
      authorization: async () => "Bearer identity-token",
      fetch: async (_input, init) => {
        seen.push(new Headers(init?.headers).get("authorization"));
        return Response.json({ code: "unsafe-url" }, { status: 422 });
      },
    });
    await expect(unsafe("https://jobs.example.test/")).rejects.toBeInstanceOf(
      UnsafeUrlAddressError,
    );
    expect(seen).toEqual(["Bearer identity-token"]);

    const refused = createRemoteUrlFetcher({
      endpoint: "https://page-fetcher.example.test",
      fetch: async () => new Response("Forbidden", { status: 403 }),
    });
    await expect(refused("https://jobs.example.test/")).rejects.toEqual(
      new RemoteFetchError("fetch-failure", 403),
    );
  });
});
