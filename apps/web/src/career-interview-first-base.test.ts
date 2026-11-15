import { describe, expect, it } from "vitest";

import type { ApiClient } from "./api-client.js";
import { firstInterviewBase } from "./career-interview-first-base.js";

/** A client that lists the given bases and records what is created and selected. */
function fakeClient(bases: readonly { id: string; state: string; createdAt: string }[]) {
  const calls: { operation: string; body?: unknown }[] = [];
  const client: ApiClient = {
    call: async (operation, input) => {
      const body = (input as { body?: unknown } | undefined)?.body;
      calls.push(body === undefined ? { operation } : { operation, body });
      if (operation === "GET /v1/knowledge-bases") return { knowledgeBases: bases } as never;
      if (operation === "POST /v1/knowledge-bases") return { id: "kb-new" } as never;
      return {} as never;
    },
  };
  return { client, calls };
}

describe("the first base of an interview summary (#2733)", () => {
  it("creates the default base when the record has none, and selects it only when asked", async () => {
    const { client, calls } = fakeClient([]);
    const first = await firstInterviewBase(client, "record-1");
    expect(first.id).toBe("kb-new");
    expect(calls.map((call) => call.operation)).toEqual([
      "GET /v1/knowledge-bases",
      "POST /v1/knowledge-bases",
    ]);
    expect(calls[1]?.body).toEqual({ displayName: "Career evidence", workspaceId: "record-1" });

    await first.select();
    expect(calls.at(-1)).toEqual({
      operation: "PUT /v1/workspaces/{workspaceId}/knowledge-selection",
      body: { knowledgeBaseIds: ["kb-new"] },
    });
  });

  it("reuses the newest active base instead of making a second one", async () => {
    const { client, calls } = fakeClient([
      { id: "kb-old", state: "active", createdAt: "2026-11-01T00:00:00.000Z" },
      { id: "kb-newer", state: "active", createdAt: "2026-11-10T00:00:00.000Z" },
      { id: "kb-gone", state: "archived", createdAt: "2026-11-12T00:00:00.000Z" },
    ]);
    expect((await firstInterviewBase(client, "record-1")).id).toBe("kb-newer");
    expect(calls.some((call) => call.operation === "POST /v1/knowledge-bases")).toBe(false);
  });
});
