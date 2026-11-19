import type { InjectOptions } from "fastify";
import { describe, expect, it } from "vitest";

import { buildApi } from "./app.js";
import { cloudLoggingOptions, errorFields } from "./logging.js";

const ownerToken = "owner-token-for-tests-0123456789abcdef";
/** Synthetic text standing in for anything a person might send. */
const marker = "SYNTHETIC-CANDIDATE-TEXT";

async function loggedLines(requests: readonly InjectOptions[], project?: string) {
  const lines: Record<string, unknown>[] = [];
  const raw: string[] = [];
  const headers: Record<string, unknown>[] = [];
  const app = await buildApi({
    ownerToken,
    logger: cloudLoggingOptions(
      {
        write: (line) => {
          raw.push(line);
          lines.push(JSON.parse(line) as Record<string, unknown>);
        },
      },
      project,
    ),
  });
  try {
    for (const request of requests) headers.push((await app.inject(request)).headers);
  } finally {
    await app.close();
  }
  return { lines, raw, headers };
}

describe("the API's logs", () => {
  it("carry the trace id of Cloud Run's traceparent, which the response echoes (#3110)", async () => {
    const traceId = "4bf92f3577b34da6a3ce929d0e0e4736";
    const { lines, headers } = await loggedLines(
      [
        {
          method: "GET",
          url: "/v1/health",
          headers: { traceparent: `00-${traceId}-00f067aa0ba902b7-01` },
        },
      ],
      "example-project",
    );

    expect(headers[0]?.["x-request-id"]).toBe(traceId);
    const requestLines = lines.filter((line) => line.reqId === traceId);
    expect(requestLines.length).toBeGreaterThanOrEqual(2);
    for (const line of requestLines) {
      expect(line["logging.googleapis.com/trace"]).toBe(
        `projects/example-project/traces/${traceId}`,
      );
    }
  });

  it("give a request without traceparent a new 32-character id, and no trace field without a project", async () => {
    const { lines, headers } = await loggedLines([{ method: "GET", url: "/v1/health" }]);

    const id = headers[0]?.["x-request-id"];
    expect(id).toMatch(/^[\da-f]{32}$/u);
    const completed = lines.find((line) => line.message === "request completed");
    expect(completed?.reqId).toBe(id);
    expect(completed).not.toHaveProperty("logging.googleapis.com/trace");
  });

  it("are Cloud Logging lines with a severity, the route pattern and the status", async () => {
    const { lines } = await loggedLines([{ method: "GET", url: "/v1/health" }]);

    const incoming = lines.find((line) => line.message === "incoming request");
    const completed = lines.find((line) => line.message === "request completed");
    expect(incoming).toMatchObject({
      severity: "INFO",
      req: { method: "GET", route: "/v1/health" },
    });
    expect(completed).toMatchObject({ severity: "INFO", res: { statusCode: 200 } });
    expect(completed).not.toHaveProperty("level");
    expect(completed).not.toHaveProperty("hostname");
  });

  it("never carry headers, bodies, queries, paths of unknown routes or client addresses", async () => {
    const { lines, raw } = await loggedLines([
      {
        method: "GET",
        url: `/v1/health?note=${marker}`,
        headers: { authorization: `Bearer ${ownerToken}`, "x-note": marker },
      },
      {
        method: "PUT",
        url: "/v1/workspaces/workspace-1",
        headers: { authorization: `Bearer ${marker}-0123456789abcdef0123456789` },
        payload: { note: marker },
      },
      { method: "GET", url: `/v1/${marker}` },
    ]);

    expect(lines.length).toBeGreaterThan(0);
    for (const line of raw) {
      expect(line).not.toContain(marker);
      expect(line).not.toContain(ownerToken);
      expect(line).not.toContain("127.0.0.1");
    }
    expect(lines).toContainEqual(
      expect.objectContaining({ req: expect.objectContaining({ route: "unmatched" }) }),
    );
  });
});

describe("errorFields", () => {
  it("keeps an error's type, code and stack frames, never its message", () => {
    const error = Object.assign(new TypeError(`could not read ${marker}`), { code: "E_READ" });

    const fields = errorFields(error);

    expect(fields).toMatchObject({ type: "TypeError", code: "E_READ" });
    expect((fields.frames as string[]).length).toBeGreaterThan(0);
    expect(JSON.stringify(fields)).not.toContain(marker);
    expect(errorFields("text")).toEqual({ type: "string" });
  });
});
