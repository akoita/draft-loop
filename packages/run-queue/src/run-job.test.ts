import { describe, expect, it } from "vitest";

import { runJobSchema } from "./run-job.js";

const ids = { tenantId: "tenant-1", workspaceId: "workspace-1", runId: "run-1" };

describe("run job payload", () => {
  it("carries the queuing request's traceparent, ids and flags only (#3238)", () => {
    const traceparent = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
    expect(runJobSchema.parse({ ...ids, traceparent })).toEqual({ ...ids, traceparent });
    expect(runJobSchema.parse(ids)).toEqual(ids);
    for (const invalid of ["", "not-a-traceparent", `${traceparent} extra`, "00-ABC-00-01"]) {
      expect(runJobSchema.safeParse({ ...ids, traceparent: invalid }).success).toBe(false);
    }
  });
});
