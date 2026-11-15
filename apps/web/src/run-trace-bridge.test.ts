import { createCapabilityPort } from "@draft-loop/ui/bridge";
import { describe, expect, it } from "vitest";

import type { ApiClient } from "./api-client.js";
import { createHttpBridge } from "./http-bridge.js";

describe("run trace over HTTP", () => {
  it("reads a run's spans from its trace route in the shared screens' shape", async () => {
    const calls: { operation: string; input: unknown }[] = [];
    const client: ApiClient = {
      call: async (operation, input) => {
        calls.push({ operation, input });
        return {
          spans: [
            {
              span_id: "span-1",
              parent_span_id: null,
              name: "invoke_workflow",
              started_at: "2026-11-11T12:00:00.000Z",
              ended_at: null,
              status: null,
              attributes: { "draftloop.run.id": "run-1" },
            },
          ],
        } as never;
      },
    };
    const port = createCapabilityPort(createHttpBridge({ client }));
    expect(port.hasCapability("run.trace")).toBe(true);
    const result = await port.execute({
      type: "run.trace",
      input: { workspaceId: "owner", runId: "run-1" },
    });
    expect(calls).toEqual([
      {
        operation: "GET /v1/workspaces/{workspaceId}/runs/{runId}/trace",
        input: { path: { workspaceId: "owner", runId: "run-1" } },
      },
    ]);
    expect(result).toEqual({
      ok: true,
      value: {
        workspaceId: "owner",
        runId: "run-1",
        spans: [
          {
            spanId: "span-1",
            parentSpanId: null,
            name: "invoke_workflow",
            startedAt: "2026-11-11T12:00:00.000Z",
            endedAt: null,
            status: null,
            attributes: { "draftloop.run.id": "run-1" },
          },
        ],
      },
    });
  });
});
