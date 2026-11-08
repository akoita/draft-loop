import { describe, expect, it } from "vitest";

import {
  boundedResearchSources,
  createScriptedResearchSearch,
  ResearchSearchSettingError,
  readResearchSearchProvider,
  researchDateOf,
  withBoundedResearchSources,
} from "./research-search.js";

const source = (url: string, excerpt = "A passage.") => ({ url, title: " Title ", excerpt });

describe("research search setting", () => {
  it("defaults to Claude's search and refuses an unknown provider", () => {
    expect(readResearchSearchProvider({})).toBe("claude");
    expect(readResearchSearchProvider({ DRAFT_LOOP_RESEARCH_SEARCH: " linkup " })).toBe("linkup");
    expect(readResearchSearchProvider({ DRAFT_LOOP_RESEARCH_SEARCH: "off" })).toBe("off");
    expect(() => readResearchSearchProvider({ DRAFT_LOOP_RESEARCH_SEARCH: "bing" })).toThrow(
      ResearchSearchSettingError,
    );
  });
});

describe("research sources", () => {
  it("reads publication dates as days", () => {
    expect(researchDateOf("2026-10-03T12:00:00Z")).toBe("2026-10-03");
    expect(researchDateOf("not a date")).toBeUndefined();
    expect(researchDateOf(undefined)).toBeUndefined();
  });

  it("keeps http links once each, trims text and stops at the limit", () => {
    const kept = boundedResearchSources(
      [
        source("javascript:alert(1)"),
        source("not a url"),
        source("https://example.org/a#top", "  one\n\n passage "),
        source("https://example.org/a"),
        source("https://example.org/empty", "   "),
        { ...source("http://example.org/b"), title: "", publishedOn: "2026-09-01" },
        source("https://example.org/c"),
      ],
      2,
    );
    expect(kept).toEqual([
      { url: "https://example.org/a", title: "Title", excerpt: "one passage" },
      {
        url: "http://example.org/b",
        title: "example.org",
        excerpt: "A passage.",
        publishedOn: "2026-09-01",
      },
    ]);
  });

  it("bounds a provider's sources and answers scripted replies in order", async () => {
    const scripted = createScriptedResearchSearch([[source("https://example.org/a")]], {
      costUsd: 0.01,
    });
    const request = { query: "Employer data analyst", fromDate: "2025-11-08", maxResults: 5 };
    expect(await scripted.search(request)).toMatchObject({ costUsd: 0.01, provider: "scripted" });
    expect((await scripted.search(request)).sources).toEqual([]);
    expect(scripted.requests).toHaveLength(2);

    const raw = {
      search: async () => ({
        sources: [source("ftp://example.org"), source("https://example.org/ok")],
        costUsd: 0,
        provider: "raw",
      }),
    };
    expect((await withBoundedResearchSources(raw).search(request)).sources).toHaveLength(1);
  });
});
