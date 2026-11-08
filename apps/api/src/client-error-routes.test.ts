import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { buildApi } from "./app.js";
import { clientErrorReportsPerWindow, clientErrorsPath } from "./client-error-routes.js";
import { cloudLoggingOptions } from "./logging.js";

const ownerToken = "owner-token-for-tests-0123456789abcdef";

let app: FastifyInstance;
let lines: Record<string, unknown>[];

async function start(): Promise<void> {
  lines = [];
  app = await buildApi({
    ownerToken,
    logger: cloudLoggingOptions({
      write: (line) => lines.push(JSON.parse(line) as Record<string, unknown>),
    }),
  });
}

const report = (payload: Record<string, unknown>, from = "203.0.113.9") =>
  app.inject({ method: "POST", url: clientErrorsPath, payload, remoteAddress: from });

const reported = () => lines.filter((line) => line.event === "client_error");

afterEach(async () => {
  await app.close();
});

describe("browser error reports (#2464)", () => {
  it("logs a thrown error once, with no credential and none of the person's text", async () => {
    await start();
    const response = await report({
      kind: "error",
      message: `Cannot parse "Lead engineer at Acme" for jane@example.com`,
      stack: [
        "    at parseCard (https://draftloop.test/assets/index-a1B2.js?token=x:10:5)",
        "Jane Doe, 12 Rue Exemple",
      ],
      route: "/workspaces/ws_123/applications/app_9/review?draft=secret",
      build: "https://draftloop.test/assets/index-a1B2.js",
    });

    expect(response.statusCode).toBe(204);
    expect(reported()).toHaveLength(1);
    expect(reported()[0]).toMatchObject({
      severity: "ERROR",
      message: "browser error reported",
      clientError: {
        kind: "error",
        message: "Cannot parse … for [address]",
        stack: ["parseCard /assets/index-a1B2.js:10:5"],
        route: "/workspaces/:id/applications/:id/review",
        build: "/assets/index-a1B2.js",
      },
    });
    const logged = JSON.stringify(lines);
    for (const text of ["Acme", "jane@", "Jane Doe", "secret", "token=x", "ws_123"]) {
      expect(logged).not.toContain(text);
    }
  });

  it("refuses unknown fields, oversized bodies and floods without logging them", async () => {
    await start();
    const base = { kind: "error", message: "boom", route: "/", build: "/assets/i.js" };

    expect((await report({ ...base, cvText: "Jane Doe" })).statusCode).toBe(400);
    expect((await report({ ...base, message: "x".repeat(9000) })).statusCode).toBe(413);
    for (let i = 0; i < clientErrorReportsPerWindow; i += 1) {
      expect((await report(base)).statusCode).toBe(204);
    }
    const flooded = await report(base);
    expect(flooded.statusCode).toBe(429);
    expect(flooded.json()).toMatchObject({ error: { code: "rate_limited" } });
    expect((await report(base, "198.51.100.4")).statusCode).toBe(204);
    expect(reported()).toHaveLength(clientErrorReportsPerWindow + 1);
    expect(JSON.stringify(lines)).not.toContain("Jane Doe");
  });
});
