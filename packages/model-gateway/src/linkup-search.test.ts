import {
  type ResearchSearchPort,
  withBoundedResearchSources,
} from "@draft-loop/application/research-search";
import { describe, expect, it } from "vitest";

import { createLinkupResearchSearch, LinkupSearchError } from "./linkup-search.js";

const secret = "lk-test-secret";

function transport(status: number, reply: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return { ok: status < 300, status, json: async () => reply };
  };
  return { calls, fetch: fetch as unknown as typeof globalThis.fetch };
}

const request = {
  query: "Example employer data analyst",
  fromDate: "2025-11-08",
  maxResults: 5,
  includeDomains: ["example.org"],
};

describe("Linkup research search", () => {
  it("sends the window and domains and maps text results to sources", async () => {
    const { calls, fetch } = transport(200, {
      results: [
        { type: "text", name: "News", url: "https://example.org/news", content: "Hiring." },
        { type: "image", name: "Logo", url: "https://example.org/logo.png" },
        { type: "text", url: "https://example.org/about", content: "About us." },
        { type: "text", name: "Broken" },
      ],
    });
    const search: ResearchSearchPort = withBoundedResearchSources(
      createLinkupResearchSearch({ resolveCredential: async () => secret, fetch }),
    );
    const reply = await search.search(request);
    expect(reply.provider).toBe("linkup");
    expect(reply.costUsd).toBeGreaterThan(0);
    expect(reply.sources).toEqual([
      { url: "https://example.org/news", title: "News", excerpt: "Hiring." },
      { url: "https://example.org/about", title: "example.org", excerpt: "About us." },
    ]);
    expect(calls[0]?.url).toBe("https://api.linkup.so/v1/search");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      q: request.query,
      depth: "standard",
      outputType: "searchResults",
      fromDate: "2025-11-08",
      maxResults: 5,
      includeDomains: ["example.org"],
    });
  });

  it("fails without a key or on an error status, never repeating the key", async () => {
    const { calls, fetch } = transport(401, { error: secret });
    await expect(
      createLinkupResearchSearch({ resolveCredential: async () => undefined, fetch }).search(
        request,
      ),
    ).rejects.toMatchObject({ name: "LinkupSearchError", code: "no_key" });
    expect(calls).toHaveLength(0);
    const failure = await createLinkupResearchSearch({
      resolveCredential: async () => secret,
      fetch,
    })
      .search(request)
      .catch((error: unknown) => error as LinkupSearchError);
    expect(failure).toBeInstanceOf(LinkupSearchError);
    expect(failure).toMatchObject({ status: 401, code: "status_401" });
    expect(String((failure as Error).message)).not.toContain(secret);
  });
});
