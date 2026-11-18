import { createCapabilityPort } from "@draft-loop/ui/bridge";
import { describe, expect, it } from "vitest";

import { type ApiClient, ApiRequestError } from "./api-client.js";
import { createHttpBridge } from "./http-bridge.js";

const map = {
  runId: "run-1",
  mode: "semantic",
  modelId: "embed-small",
  chunkCount: 12,
  grading: "graded",
  requirements: [
    {
      requirementId: "req-1",
      text: "Builds data pipelines",
      candidates: [
        {
          chunkId: "chunk-1",
          origin: "both",
          score: 0.71,
          source: "cv.md",
          lineStart: 3,
          lineEnd: 7,
          grade: "supports",
        },
      ],
    },
  ],
};

describe("run requirement evidence over HTTP", () => {
  it("reads a run's map from its requirement-evidence route", async () => {
    const calls: { operation: string; input: unknown }[] = [];
    const client: ApiClient = {
      call: async (operation, input) => {
        calls.push({ operation, input });
        return map as never;
      },
    };
    const port = createCapabilityPort(createHttpBridge({ client }));
    expect(port.hasCapability("run.requirement-evidence")).toBe(true);
    const result = await port.execute({
      type: "run.requirement-evidence",
      input: { workspaceId: "owner", runId: "run-1" },
    });
    expect(calls).toEqual([
      {
        operation: "GET /v1/workspaces/{workspaceId}/runs/{runId}/requirement-evidence",
        input: { path: { workspaceId: "owner", runId: "run-1" } },
      },
    ]);
    expect(result).toEqual({
      ok: true,
      value: { workspaceId: "owner", runId: "run-1", evidence: map },
    });
  });

  it("answers no map for a run that recorded none", async () => {
    const client: ApiClient = {
      call: async () => {
        throw new ApiRequestError(404, "not_found", "No map.");
      },
    };
    const port = createCapabilityPort(createHttpBridge({ client }));
    const result = await port.execute({
      type: "run.requirement-evidence",
      input: { workspaceId: "owner", runId: "run-1" },
    });
    expect(result).toEqual({
      ok: true,
      value: { workspaceId: "owner", runId: "run-1", evidence: null },
    });
  });
});
