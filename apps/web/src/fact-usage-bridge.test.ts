import { createCapabilityPort } from "@draft-loop/ui/bridge";
import { describe, expect, it } from "vitest";

import type { ApiClient } from "./api-client.js";
import { createHttpBridge } from "./http-bridge.js";

const workspaceId = "owner";
const key = "fu1-achievement-0123456789abcdef";

function portOver(handlers: Readonly<Record<string, (input: Record<string, unknown>) => unknown>>) {
  const calls: { operation: string; input: Record<string, unknown> }[] = [];
  const client: ApiClient = {
    call: async (operation, input) => {
      calls.push({ operation, input: input as Record<string, unknown> });
      const handler = handlers[operation];
      if (handler === undefined) throw new Error(`unexpected call: ${operation}`);
      return (await handler(input as Record<string, unknown>)) as never;
    },
  };
  return { port: createCapabilityPort(createHttpBridge({ client })), calls };
}

describe("fact usage over HTTP", () => {
  it("reads and sets usage levels by key, never by fact text", async () => {
    const { port, calls } = portOver({
      "GET /v1/workspaces/{workspaceId}/fact-usage": () => ({ usage: { sections: {}, facts: {} } }),
      "PUT /v1/workspaces/{workspaceId}/fact-usage": () => ({
        usage: { sections: {}, facts: { [key]: "never-say" } },
      }),
    });
    expect(port.hasCapability("fact-usage.get")).toBe(true);
    const read = await port.execute({ type: "fact-usage.get", input: { workspaceId } });
    expect(read).toEqual({ ok: true, value: { workspaceId, usage: { sections: {}, facts: {} } } });
    const set = await port.execute({
      type: "fact-usage.set",
      input: { workspaceId, change: { kind: "fact", key, level: "never-say" } },
    });
    expect(set).toEqual({
      ok: true,
      value: { workspaceId, usage: { sections: {}, facts: { [key]: "never-say" } } },
    });
    expect(calls[1]).toEqual({
      operation: "PUT /v1/workspaces/{workspaceId}/fact-usage",
      input: { path: { workspaceId }, body: { kind: "fact", key, level: "never-say" } },
    });
  });

  it("refuses fact text in place of a key before calling the server", async () => {
    const { port, calls } = portOver({});
    const result = await port.execute({
      type: "fact-usage.set",
      input: { workspaceId, change: { kind: "fact", key: "my salary", level: "cv" } },
    } as never);
    expect(result.ok).toBe(false);
    expect(calls).toEqual([]);
  });
});
