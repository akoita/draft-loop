import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApi } from "./app.js";
import { isPublicRequest } from "./web-screen.js";

const ownerToken = "owner-token-for-tests-0123456789abcdef";
const page =
  '<!doctype html><html><head><script type="module" src="/assets/index-abc.js"></script></head><body><div id="root"></div></body></html>';

let webRoot: string;
let app: FastifyInstance;

beforeAll(async () => {
  webRoot = await mkdtemp(join(tmpdir(), "draft-loop-web-"));
  await mkdir(join(webRoot, "assets"));
  await writeFile(join(webRoot, "index.html"), page);
  await writeFile(join(webRoot, "assets", "index-abc.js"), "console.log('screen');");
  app = await buildApi({ ownerToken, webRoot });
});

afterAll(async () => {
  await app.close();
  await rm(webRoot, { recursive: true, force: true });
});

describe("web screen", () => {
  it("serves the page at / without a token, with a same-origin policy", async () => {
    const response = await app.inject({ method: "GET", url: "/" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toMatch(/^text\/html/);
    expect(response.headers["cache-control"]).toBe("no-cache");
    expect(response.body).toBe(page);
    const policy = String(response.headers["content-security-policy"]);
    expect(policy).toContain("script-src 'self'");
    expect(policy).toContain("style-src 'self'");
    expect(policy).toContain("connect-src 'self'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).not.toContain("unsafe-inline");
  });

  it("serves hashed assets as immutable", async () => {
    const response = await app.inject({ method: "GET", url: "/assets/index-abc.js" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
  });

  it("answers a missing file with the error shape", async () => {
    const response = await app.inject({ method: "GET", url: "/missing.js" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: "not_found" } });
  });

  it("still requires the token on /v1, including unknown routes", async () => {
    for (const url of ["/v1/knowledge-bases", "/v1/unknown", "/v1"]) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode, url).toBe(401);
    }
  });

  it("serves no page when the API has no web directory", async () => {
    const bare = await buildApi({ ownerToken });
    try {
      const response = await bare.inject({ method: "GET", url: "/" });
      expect(response.statusCode).toBe(401);
    } finally {
      await bare.close();
    }
  });
});

describe("public requests", () => {
  it.each([
    ["/v1/health", "/v1/health", true],
    ["/*", "/assets/index-abc.js", true],
    ["/", "/", true],
    ["/*", "/v1/unknown", false],
    ["/*", "/v1", false],
    [undefined, "/anything", false],
    ["/v1/knowledge-bases", "/v1/knowledge-bases", false],
  ])("route %s at %s is public: %s", (route, path, expected) => {
    expect(isPublicRequest(route, path)).toBe(expected);
  });
});
