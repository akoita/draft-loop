import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApi } from "./app.js";
import { canonicalLinkHeader, readPublicSite, robotsText, sitemapXml } from "./public-site.js";

const ownerToken = "owner-token-for-tests-0123456789abcdef";
const origin = "https://draftloop.example";
const page = (body: string) =>
  `<!doctype html><html><head><link rel="canonical" href="__SITE_ORIGIN__/${body}"></head><body></body></html>`;

let webRoot: string;

beforeAll(async () => {
  webRoot = await mkdtemp(join(tmpdir(), "draft-loop-public-site-"));
  await mkdir(join(webRoot, "about", "fr"), { recursive: true });
  await mkdir(join(webRoot, "showcase"));
  await writeFile(join(webRoot, "index.html"), page(""));
  await writeFile(join(webRoot, "about", "index.html"), page("about/"));
  await writeFile(join(webRoot, "about", "fr", "index.html"), page("about/fr/"));
  await writeFile(join(webRoot, "showcase", "index.html"), page("showcase/"));
});

afterAll(async () => {
  await rm(webRoot, { recursive: true, force: true });
});

describe("reading the public site settings", () => {
  it("keeps indexing off unless the deployment turns it on", () => {
    expect(readPublicSite({})).toEqual({ indexing: false });
    expect(readPublicSite({ DRAFT_LOOP_PUBLIC_URL: `${origin}/some/path` })).toEqual({
      indexing: false,
      origin,
    });
    expect(
      readPublicSite({ DRAFT_LOOP_SEARCH_INDEXING: "on", DRAFT_LOOP_PUBLIC_URL: origin }),
    ).toEqual({ indexing: true, origin });
  });

  it("refuses indexing without an https public address, and unknown values", () => {
    expect(() => readPublicSite({ DRAFT_LOOP_SEARCH_INDEXING: "on" })).toThrow(/PUBLIC_URL/);
    expect(() =>
      readPublicSite({
        DRAFT_LOOP_SEARCH_INDEXING: "on",
        DRAFT_LOOP_PUBLIC_URL: "http://draftloop.example",
      }),
    ).toThrow(/PUBLIC_URL/);
    expect(() => readPublicSite({ DRAFT_LOOP_SEARCH_INDEXING: "yes" })).toThrow(/on or off/);
  });
});

describe("search engine files", () => {
  it("blocks every crawler while indexing is off", () => {
    expect(robotsText({ indexing: false, origin })).toBe("User-agent: *\nDisallow: /\n");
  });

  it("lists the sitemap and keeps the API out when indexing is on", () => {
    const robots = robotsText({ indexing: true, origin });
    expect(robots).toContain("Disallow: /v1/");
    expect(robots).toContain(`Sitemap: ${origin}/sitemap.xml`);
  });

  it("lists each public page with its other language", () => {
    const xml = sitemapXml(origin);
    expect(xml).toContain(`<loc>${origin}/</loc>`);
    expect(xml).toContain(`<loc>${origin}/about/fr/</loc>`);
    expect(xml).toContain(`<loc>${origin}/legal/fr/privacy</loc>`);
    expect(xml).toContain(`hreflang="fr" href="${origin}/about/fr/"`);
    expect(xml).not.toContain("showcase");
  });

  it("names the canonical address and the language versions of a page", () => {
    const link = canonicalLinkHeader(origin, "/about/fr/index.html");
    expect(link).toContain(`<${origin}/about/fr/>; rel="canonical"`);
    expect(link).toContain(`<${origin}/about/>; rel="alternate"; hreflang="en"`);
    expect(canonicalLinkHeader(origin, "/v1/health")).toBeUndefined();
  });
});

describe("the public site on the API", () => {
  let indexed: FastifyInstance;
  let unindexed: FastifyInstance;

  beforeAll(async () => {
    indexed = await buildApi({ ownerToken, webRoot, publicSite: { indexing: true, origin } });
    unindexed = await buildApi({ ownerToken, webRoot });
  });

  afterAll(async () => {
    await indexed.close();
    await unindexed.close();
  });

  it("serves robots.txt and the sitemap without a token", async () => {
    const robots = await indexed.inject({ method: "GET", url: "/robots.txt" });
    expect(robots.statusCode).toBe(200);
    expect(robots.headers["content-type"]).toMatch(/^text\/plain/);
    const sitemap = await indexed.inject({ method: "GET", url: "/sitemap.xml" });
    expect(sitemap.statusCode).toBe(200);
    expect(sitemap.body).toContain(`<loc>${origin}/about/</loc>`);
  });

  it("fills the origin and the canonical link in the public pages", async () => {
    const response = await indexed.inject({ method: "GET", url: "/about/fr/" });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain(`href="${origin}/about/fr/"`);
    expect(response.headers["x-robots-tag"]).toBeUndefined();
    expect(String(response.headers.link)).toContain(`<${origin}/about/fr/>; rel="canonical"`);
    const home = await indexed.inject({ method: "GET", url: "/" });
    expect(home.body).toContain(`href="${origin}/"`);
  });

  it("keeps the sample pages out of search results", async () => {
    const response = await indexed.inject({ method: "GET", url: "/showcase/" });
    expect(response.headers["x-robots-tag"]).toBe("noindex, nofollow");
  });

  it("marks everything noindex and serves no sitemap when indexing is off", async () => {
    const page = await unindexed.inject({ method: "GET", url: "/about/" });
    expect(page.headers["x-robots-tag"]).toBe("noindex, nofollow");
    expect(page.body).toContain('href="/about/"');
    const legal = await unindexed.inject({ method: "GET", url: "/legal/en/terms" });
    expect(legal.headers["x-robots-tag"]).toBe("noindex, nofollow");
    const sitemap = await unindexed.inject({ method: "GET", url: "/sitemap.xml" });
    expect(sitemap.statusCode).toBe(404);
  });

  it("sends the favicon request to the mark", async () => {
    const response = await unindexed.inject({ method: "GET", url: "/favicon.ico" });
    expect(response.statusCode).toBe(301);
    expect(response.headers.location).toBe("/showcase/mark.svg");
  });
});
