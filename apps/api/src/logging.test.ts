import type { InjectOptions } from "fastify";
import { describe, expect, it } from "vitest";

import { buildApi } from "./app.js";
import { cloudLoggingOptions, errorFields } from "./logging.js";

const ownerToken = "owner-token-for-tests-0123456789abcdef";
/** Synthetic text standing in for anything a person might send. */
const marker = "SYNTHETIC-CANDIDATE-TEXT";

async function loggedLines(requests: readonly InjectOptions[]) {
  const lines: Record<string, unknown>[] = [];
  const raw: string[] = [];
  const app = await buildApi({
    ownerToken,
    logger: cloudLoggingOptions({
      write: (line) => {
        raw.push(line);
        lines.push(JSON.parse(line) as Record<string, unknown>);
      },
    }),
  });
  try {
    for (const request of requests) await app.inject(request);
  } finally {
    await app.close();
  }
  return { lines, raw };
}

describe("the API's logs", () => {
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
