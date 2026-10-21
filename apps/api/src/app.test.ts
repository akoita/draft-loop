import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { apiBodyLimitBytes, buildApi } from "./app.js";

const ownerToken = "owner-token-for-tests-0123456789abcdef";
const authorization = `Bearer ${ownerToken}`;

let app: FastifyInstance;

beforeEach(async () => {
  app = await buildApi({ ownerToken });
});

afterEach(async () => {
  await app.close();
});

describe("health", () => {
  it("answers without a token", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("sends security headers", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/health" });

    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["strict-transport-security"]).toBeDefined();
  });
});

describe("owner-only access", () => {
  it.each([
    ["no header", undefined],
    ["a wrong token", "Bearer not-the-owner-token-0123456789abcdef"],
    ["a token prefix", `Bearer ${ownerToken.slice(0, -1)}`],
    ["another scheme", `Basic ${ownerToken}`],
    ["trailing content", `${authorization} extra`],
  ])("refuses %s", async (_label, header) => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/openapi.json",
      ...(header === undefined ? {} : { headers: { authorization: header } }),
    });

    expect(response.statusCode).toBe(401);
    expect(response.headers["www-authenticate"]).toBe("Bearer");
    expect(response.json()).toEqual({
      error: { code: "unauthorized", message: "A valid owner token is required." },
    });
  });

  it("refuses unknown routes without a token, so routes cannot be enumerated", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/unknown" });

    expect(response.statusCode).toBe(401);
  });

  it("does not make a route public through a query string", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/openapi.json?/v1/health" });

    expect(response.statusCode).toBe(401);
  });

  it("answers unknown routes with the error shape for the owner", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/unknown",
      headers: { authorization },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: { code: "not_found", message: "No such route." } });
  });
});

describe("OpenAPI document", () => {
  it("is generated from the route schemas", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/openapi.json",
      headers: { authorization },
    });

    expect(response.statusCode).toBe(200);
    const document = response.json();
    expect(document.openapi).toBe("3.1.0");
    expect(document.security).toEqual([{ ownerToken: [] }]);
    expect(document.paths["/v1/health"].get.security).toEqual([]);
    expect(document.paths["/v1/health"].get.responses["200"]).toBeDefined();
    expect(document.paths["/v1/openapi.json"]).toBeUndefined();
  });
});

describe("errors", () => {
  async function appWithEcho(): Promise<FastifyInstance> {
    const echo = await buildApi({ ownerToken });
    echo.post(
      "/v1/test-echo",
      { schema: { body: z.strictObject({ name: z.string() }) } },
      async (request) => request.body,
    );
    echo.get("/v1/test-failure", async () => {
      throw new Error("candidate material that must not leak");
    });
    return echo;
  }

  it("names invalid fields without repeating their values", async () => {
    const echo = await appWithEcho();
    const response = await echo.inject({
      method: "POST",
      url: "/v1/test-echo",
      headers: { authorization },
      payload: { name: 42, secret: "private value" },
    });
    await echo.close();

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error.code).toBe("invalid_request");
    expect(body.error.issues.length).toBeGreaterThan(0);
    expect(response.body).not.toContain("private value");
  });

  it("refuses a body over the size limit", async () => {
    const echo = await appWithEcho();
    const response = await echo.inject({
      method: "POST",
      url: "/v1/test-echo",
      headers: { authorization, "content-type": "application/json" },
      payload: JSON.stringify({ name: "x".repeat(apiBodyLimitBytes) }),
    });
    await echo.close();

    expect(response.statusCode).toBe(413);
    expect(response.json().error.code).toBe("payload_too_large");
  });

  it("does not quote malformed JSON back", async () => {
    const echo = await appWithEcho();
    const response = await echo.inject({
      method: "POST",
      url: "/v1/test-echo",
      headers: { authorization, "content-type": "application/json" },
      payload: '{"name": "private value"',
    });
    await echo.close();

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("bad_request");
    expect(response.body).not.toContain("private value");
  });

  it("hides the cause of an unexpected failure", async () => {
    const echo = await appWithEcho();
    const response = await echo.inject({
      method: "GET",
      url: "/v1/test-failure",
      headers: { authorization },
    });
    await echo.close();

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: { code: "internal", message: "The server could not complete the request." },
    });
  });
});
