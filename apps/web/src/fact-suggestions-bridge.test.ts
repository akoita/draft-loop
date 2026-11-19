import { createCapabilityPort } from "@draft-loop/ui/bridge";
import { describe, expect, it } from "vitest";

import type { ApiClient } from "./api-client.js";
import { createHttpBridge } from "./http-bridge.js";

const workspaceId = "owner";
const profileId = "profile-1";
const stored = {
  schemaVersion: 1,
  id: "fsg_correct001",
  profileId,
  baseVersionId: "v1",
  change: { kind: "correct", value: "Staff engineer" },
  target: { factId: "fact-role", factKey: "fu1-role-0123456789abcdef" },
  quote: "I was promoted in March.",
  speaker: "candidate",
  origin: { kind: "review-edit", applicationId: "app-1", runId: "run-1", round: 1, blockId: "b" },
  dedupeKey: "fsk1-correct-0123456789abcdef",
  status: "pending",
  createdAt: "2026-11-19T10:00:00.000Z",
};

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

describe("suggested profile updates over HTTP", () => {
  it("lists pending suggestions with only what the card shows", async () => {
    const { port, calls } = portOver({
      "GET /v1/workspaces/{workspaceId}/profiles/{profileId}/suggestions": () => ({
        suggestions: [stored],
        pending: 1,
      }),
    });
    const listed = await port.execute({
      type: "fact-suggestions.list",
      input: { workspaceId, profileId },
    });
    expect(listed).toEqual({
      ok: true,
      value: {
        workspaceId,
        profileId,
        pending: 1,
        suggestions: [
          {
            id: stored.id,
            profileId,
            change: stored.change,
            target: stored.target,
            quote: stored.quote,
            speaker: "candidate",
            origin: { kind: "review-edit", applicationId: "app-1", round: 1 },
            status: "pending",
            createdAt: stored.createdAt,
          },
        ],
      },
    });
    expect(calls[0]?.input).toEqual({
      path: { workspaceId, profileId },
      query: { status: "pending", limit: 200 },
    });
  });

  it("accepts with an edit and rejects one", async () => {
    const { port, calls } = portOver({
      "POST /v1/workspaces/{workspaceId}/profiles/{profileId}/suggestions/accept": () => ({
        applied: [stored.id],
        stale: [],
        profile: { version: 2, status: "reviewed" },
      }),
      "POST /v1/workspaces/{workspaceId}/profiles/{profileId}/suggestions/{suggestionId}/reject":
        () => null,
    });
    const accepted = await port.execute({
      type: "fact-suggestions.accept",
      input: {
        workspaceId,
        profileId,
        items: [{ id: stored.id, edit: { kind: "correct", value: "Principal engineer" } }],
      },
    });
    expect(accepted).toEqual({
      ok: true,
      value: { applied: [stored.id], stale: [], profile: { version: 2, status: "reviewed" } },
    });
    expect(calls[0]?.input).toEqual({
      path: { workspaceId, profileId },
      body: { items: [{ id: stored.id, edit: { kind: "correct", value: "Principal engineer" } }] },
    });
    const rejected = await port.execute({
      type: "fact-suggestions.reject",
      input: { workspaceId, profileId, suggestionId: stored.id },
    });
    expect(rejected).toEqual({ ok: true, value: { suggestionId: stored.id } });
  });

  it("refuses a malformed id before calling the server", async () => {
    const { port, calls } = portOver({});
    const result = await port.execute({
      type: "fact-suggestions.reject",
      input: { workspaceId, profileId, suggestionId: "../other" },
    } as never);
    expect(result.ok).toBe(false);
    expect(calls).toEqual([]);
  });
});
