import type { KnowledgeBaseOwners } from "@draft-loop/storage/knowledge-base-owners";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { registerOwnerTokenKnowledge } from "./owner-token-knowledge.js";

/** Bases by id, each with its owning workspace; `base-legacy` predates owners. */
const baseOwners = new Map<string, string | undefined>([
  ["base-a", "workspace-a"],
  ["base-b", "workspace-b"],
  ["base-legacy", undefined],
]);

function fakeOwners(overrides: Partial<KnowledgeBaseOwners> = {}): KnowledgeBaseOwners {
  return {
    setOwner: vi.fn(async (input) => ({ ...input, recordedAt: "2026-01-01T00:00:00.000Z" })),
    ownerOf: vi.fn(async (id: string) => baseOwners.get(id)),
    basesOwnedBy: async (workspaces) =>
      [...baseOwners]
        .filter(([, owner]) => owner !== undefined && workspaces.includes(owner))
        .map(([id]) => id),
    removeUnowned: vi.fn(async () => true),
    ...overrides,
  };
}

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

/** A server whose caller is the owner token, or a member with the `x-test-member` header. */
function ownerTokenServer(owners: KnowledgeBaseOwners = fakeOwners()) {
  const server = Fastify();
  server.decorateRequest("caller", undefined);
  server.addHook("onRequest", async (request) => {
    request.caller =
      request.headers["x-test-member"] === "yes"
        ? { kind: "member", tenantId: "tenant-1", memberId: "member-1", role: "member" }
        : { kind: "owner" };
  });
  const ownership = registerOwnerTokenKnowledge(server, owners);
  server.put("/v1/workspaces/:workspaceId/knowledge-selection", async () => ({ ok: true }));
  server.post("/v1/workspaces/:workspaceId/other", async () => ({ ok: true }));
  server.post("/v1/knowledge-bases", async (request) => {
    const { workspaceId } = request.body as { workspaceId: string };
    await ownership.setOwner(request, "base-new", workspaceId);
    return { ok: true };
  });
  server.get("/v1/knowledge-bases", async (request) => {
    const { workspaceId } = request.query as { workspaceId?: string };
    const listable = await ownership.listable(request, workspaceId);
    return { listable: listable === undefined ? "every" : [...listable] };
  });
  app = server;
  return server;
}

function select(server: FastifyInstance, knowledgeBaseIds: unknown, member = false) {
  return server.inject({
    method: "PUT",
    url: "/v1/workspaces/workspace-a/knowledge-selection",
    headers: member ? { "x-test-member": "yes" } : {},
    payload: { knowledgeBaseIds },
  });
}

describe("registerOwnerTokenKnowledge", () => {
  it("lets a workspace select its own bases and those created before bases had owners", async () => {
    const server = ownerTokenServer();

    const response = await select(server, ["base-a", "base-legacy", "base-unknown", 3]);

    expect(response.statusCode).toBe(200);
  });

  it("refuses another workspace's base as unknown", async () => {
    const server = ownerTokenServer();

    const response = await select(server, ["base-a", "base-b"]);

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: "knowledge_base_not_found", message: "No such knowledge base." },
    });
  });

  it("leaves members, other routes and malformed selections to their own checks", async () => {
    const owners = fakeOwners();
    const server = ownerTokenServer(owners);

    const memberCall = await select(server, ["base-b"], true);
    const malformed = await select(server, "base-b");
    const other = await server.inject({
      method: "POST",
      url: "/v1/workspaces/workspace-a/other",
      payload: { knowledgeBaseIds: ["base-b"] },
    });

    expect([memberCall.statusCode, malformed.statusCode, other.statusCode]).toEqual([
      200, 200, 200,
    ]);
    expect(owners.ownerOf).not.toHaveBeenCalled();
  });

  it("lists every base, or only one workspace's", async () => {
    const server = ownerTokenServer();

    const every = await server.inject({ url: "/v1/knowledge-bases" });
    const one = await server.inject({ url: "/v1/knowledge-bases?workspaceId=workspace-b" });

    expect(every.json()).toEqual({ listable: "every" });
    expect(one.json()).toEqual({ listable: ["base-b"] });
  });

  it("records a new base's owner", async () => {
    const owners = fakeOwners();
    const server = ownerTokenServer(owners);

    const response = await server.inject({
      method: "POST",
      url: "/v1/knowledge-bases",
      payload: { workspaceId: "workspace-a" },
    });

    expect(response.statusCode).toBe(200);
    expect(owners.setOwner).toHaveBeenCalledWith({
      knowledgeBaseId: "base-new",
      workspaceId: "workspace-a",
    });
    expect(owners.removeUnowned).not.toHaveBeenCalled();
  });

  it("removes the new base, and reports the owner write's error, when recording fails", async () => {
    const owners = fakeOwners({
      setOwner: vi.fn(async () => {
        throw new Error("Owner write failed.");
      }),
      removeUnowned: vi.fn(async () => {
        throw new Error("Cleanup failed.");
      }),
    });
    const server = ownerTokenServer(owners);

    const response = await server.inject({
      method: "POST",
      url: "/v1/knowledge-bases",
      payload: { workspaceId: "workspace-a" },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ message: "Owner write failed." });
    expect(owners.removeUnowned).toHaveBeenCalledWith("base-new");
  });
});
