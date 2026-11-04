import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { buildApi } from "./app.js";

const ownerToken = "owner-token-for-tests-0123456789abcdef";
const authorization = `Bearer ${ownerToken}`;

let app: FastifyInstance;
let clock = 0;

async function start(requestsPerWindow: number, refusedPerWindow: number): Promise<void> {
  clock = 1_000_000;
  app = await buildApi({
    ownerToken,
    rateLimits: { requestsPerWindow, refusedPerWindow, windowMs: 60_000, now: () => clock },
  });
}

const get = (url: string, from = "203.0.113.7", header: string | undefined = authorization) =>
  app.inject({
    method: "GET",
    url,
    remoteAddress: from,
    ...(header === undefined ? {} : { headers: { authorization: header } }),
  });

afterEach(async () => {
  await app.close();
});

describe("request rate limit", () => {
  it("answers 429 rate_limited past the limit, per address, until the window resets", async () => {
    await start(3, 30);
    for (let i = 0; i < 3; i += 1) expect((await get("/v1/openapi.json")).statusCode).toBe(200);

    const limited = await get("/v1/openapi.json");
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe("rate_limited");
    expect(limited.headers["retry-after"]).toBe("60");
    expect((await get("/v1/openapi.json", "198.51.100.2")).statusCode).toBe(200);

    clock += 60_000;
    expect((await get("/v1/openapi.json")).statusCode).toBe(200);
  });

  it("refuses an address that keeps presenting refused tokens, even with the right one", async () => {
    await start(100, 2);
    const wrong = "Bearer not-the-owner-token-0123456789abcdef";
    expect((await get("/v1/openapi.json", undefined, wrong)).statusCode).toBe(401);
    expect((await get("/v1/openapi.json", undefined, wrong)).statusCode).toBe(401);

    const limited = await get("/v1/openapi.json");
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe("rate_limited");

    clock += 60_000;
    expect((await get("/v1/openapi.json")).statusCode).toBe(200);
  });

  it("never limits health", async () => {
    await start(1, 1);
    for (let i = 0; i < 5; i += 1) {
      expect((await get("/v1/health", undefined, undefined)).statusCode).toBe(200);
    }
  });
});
