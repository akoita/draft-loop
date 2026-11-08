import type { ClientErrorReport } from "@draft-loop/domain/client-error-report";
import { describe, expect, it, vi } from "vitest";

import {
  type ErrorReportingTarget,
  installErrorReporting,
  maxReportsPerTab,
  sendErrorReport,
} from "./error-reporting.js";

function fakeTarget() {
  const listeners = new Map<string, (event: never) => void>();
  const target = {
    addEventListener: (type: string, listener: (event: never) => void) => {
      listeners.set(type, listener);
    },
  } as ErrorReportingTarget;
  const fire = (type: "error" | "unhandledrejection", event: object) =>
    listeners.get(type)?.(event as never);
  return { target, fire };
}

function install() {
  const { target, fire } = fakeTarget();
  const sent: ClientErrorReport[] = [];
  installErrorReporting({
    target,
    send: (report) => sent.push(report),
    route: () => "/workspaces/ws_1/applications/a-9/review",
    build: "/assets/index-a1B2.js",
  });
  return { fire, sent };
}

describe("browser error reporting (#2464)", () => {
  it("sends a thrown error once, without the person's text", () => {
    const { fire, sent } = install();
    const error = new TypeError(`Cannot read "Jane Doe" of undefined`);
    error.stack = `TypeError: Cannot read "Jane Doe"\n    at render (https://h.test/assets/index-a1B2.js?x=1:3:9)`;

    fire("error", { error, message: error.message });
    fire("error", { error, message: error.message });

    expect(sent).toEqual([
      {
        kind: "error",
        message: "TypeError: Cannot read … of undefined",
        stack: ["render /assets/index-a1B2.js:3:9"],
        route: "/workspaces/:id/applications/:id/review",
        build: "/assets/index-a1B2.js",
      },
    ]);
  });

  it("names only the type of a rejection that is not an error, and stops after a few", () => {
    const { fire, sent } = install();
    fire("unhandledrejection", { reason: { cv: "Jane Doe" } });
    expect(sent[0]).toMatchObject({
      kind: "unhandled_rejection",
      message: "Non-error rejection (object)",
      stack: [],
    });
    for (let i = 0; i < 10; i += 1) fire("error", { error: new Error(`boom ${"x".repeat(i)}`) });
    expect(sent).toHaveLength(maxReportsPerTab);
    expect(JSON.stringify(sent)).not.toContain("Jane");
  });

  it("posts without credentials and swallows a failed post", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error("offline"));
    sendErrorReport(fetchImpl)({
      kind: "error",
      message: "boom",
      stack: [],
      route: "/",
      build: "unknown",
    });
    await Promise.resolve();
    expect(fetchImpl).toHaveBeenCalledWith(
      "/v1/client-errors",
      expect.objectContaining({ method: "POST", credentials: "omit", keepalive: true }),
    );
  });
});
