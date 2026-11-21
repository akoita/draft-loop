import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import {
  currentRequestId,
  currentTraceparent,
  registerRequestTrace,
  requestIdFrom,
  traceFields,
  traceparentFor,
} from "./request-trace.js";

describe("request ids", () => {
  it("takes the trace id of a valid traceparent and makes a new one otherwise", () => {
    const traceId = "4bf92f3577b34da6a3ce929d0e0e4736";
    expect(requestIdFrom(`00-${traceId}-00f067aa0ba902b7-01`)).toBe(traceId);
    expect(requestIdFrom(`00-${traceId.toUpperCase()}-00f067aa0ba902b7-01`)).toBe(traceId);
    for (const invalid of [
      undefined,
      "",
      "not-a-traceparent",
      `00-${"0".repeat(32)}-00f067aa0ba902b7-01`,
      `00-${traceId}-short-01`,
    ]) {
      const id = requestIdFrom(invalid);
      expect(id).toMatch(/^[\da-f]{32}$/u);
      expect(id).not.toBe(traceId);
    }
  });

  it("names Cloud Logging's trace only with a project", () => {
    expect(traceFields("abc", undefined)).toEqual({});
    expect(traceFields("abc", "p")).toEqual({
      "logging.googleapis.com/trace": "projects/p/traces/abc",
    });
  });

  it("keeps the request's id for everything its handler runs", async () => {
    const app = Fastify({ genReqId: () => "request-1" });
    registerRequestTrace(app);
    app.get("/", async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return { id: currentRequestId() ?? null };
    });
    expect((await app.inject({ method: "GET", url: "/" })).json()).toEqual({ id: "request-1" });
    expect(currentRequestId()).toBeUndefined();
    await app.close();
  });

  it("keeps the incoming traceparent for queued work, or opens a span in the request's trace (#3238)", () => {
    const traceId = "4bf92f3577b34da6a3ce929d0e0e4736";
    const header = `00-${traceId}-00f067aa0ba902b7-00`;
    expect(traceparentFor(traceId, header)).toBe(header);
    expect(traceparentFor(traceId, header.toUpperCase())).toBe(header);
    for (const other of [
      undefined,
      `00-${"1".repeat(32)}-00f067aa0ba902b7-01`,
      `00-${traceId}-${"0".repeat(16)}-01`,
      `01-${traceId}-00f067aa0ba902b7-01`,
    ]) {
      expect(traceparentFor(traceId, other)).toMatch(
        new RegExp(`^00-${traceId}-[\\da-f]{16}-01$`, "u"),
      );
    }
    expect(traceparentFor("request-1", header)).toBeUndefined();
  });

  it("gives everything the handler runs the request's traceparent (#3238)", async () => {
    const traceId = "4bf92f3577b34da6a3ce929d0e0e4736";
    const header = `00-${traceId}-00f067aa0ba902b7-01`;
    const app = Fastify({ genReqId: (request) => requestIdFrom(request.headers.traceparent) });
    registerRequestTrace(app);
    app.get("/", async () => ({ traceparent: currentTraceparent() ?? null }));
    const response = await app.inject({
      method: "GET",
      url: "/",
      headers: { traceparent: header },
    });
    expect(response.json()).toEqual({ traceparent: header });
    expect(currentTraceparent()).toBeUndefined();
    await app.close();
  });
});
