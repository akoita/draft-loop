import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApi } from "./app.js";
import { movesToPublicOrigin, readPreviousHosts } from "./previous-hosts.js";
import { readPublicSite } from "./public-site.js";

const ownerToken = "owner-token-for-tests-0123456789abcdef";
const origin = "https://new.example";
const previous = "old.example";

describe("reading the previous public hosts", () => {
  it("takes comma-separated host names, and none by default", () => {
    expect(readPreviousHosts(undefined)).toEqual([]);
    expect(readPreviousHosts(" Old.Example , older.example,")).toEqual([
      "old.example",
      "older.example",
    ]);
    expect(() => readPreviousHosts("https://old.example/")).toThrow(/host names only/);
  });

  it("needs the public URL to redirect to", () => {
    expect(() => readPublicSite({ DRAFT_LOOP_PREVIOUS_PUBLIC_HOSTS: previous })).toThrow(
      /PUBLIC_URL/,
    );
    expect(
      readPublicSite({ DRAFT_LOOP_PREVIOUS_PUBLIC_HOSTS: previous, DRAFT_LOOP_PUBLIC_URL: origin }),
    ).toEqual({ indexing: false, origin, previousHosts: [previous] });
  });

  it("moves page reads only, never the API or well-known files", () => {
    expect(movesToPublicOrigin("GET", "/about/fr/")).toBe(true);
    expect(movesToPublicOrigin("HEAD", "/")).toBe(true);
    expect(movesToPublicOrigin("POST", "/")).toBe(false);
    expect(movesToPublicOrigin("GET", "/v1/health")).toBe(false);
    expect(movesToPublicOrigin("GET", "/.well-known/oauth-protected-resource")).toBe(false);
  });
});

describe("the redirect from a previous host", () => {
  let api: FastifyInstance;
  let webRoot: string;

  beforeAll(async () => {
    webRoot = await mkdtemp(join(tmpdir(), "draft-loop-previous-hosts-"));
    await writeFile(join(webRoot, "index.html"), "<!doctype html><title>Home</title>");
    api = await buildApi({
      ownerToken,
      webRoot,
      publicSite: { indexing: true, origin, previousHosts: [previous] },
    });
  });

  afterAll(async () => {
    await api.close();
    await rm(webRoot, { recursive: true, force: true });
  });

  it("sends a page on the old host to the same path and query on the new one", async () => {
    const response = await api.inject({
      method: "GET",
      url: "/guide/fr/?q=export",
      headers: { host: previous },
    });
    expect(response.statusCode).toBe(301);
    expect(response.headers.location).toBe(`${origin}/guide/fr/?q=export`);
  });

  it("keeps serving the API on the old host, and pages on the new one", async () => {
    const health = await api.inject({
      method: "GET",
      url: "/v1/health",
      headers: { host: previous },
    });
    expect(health.statusCode).not.toBe(301);
    const home = await api.inject({ method: "GET", url: "/", headers: { host: "new.example" } });
    expect(home.statusCode).toBe(200);
  });
});
