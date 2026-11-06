import { type ApplicationService, WorkspaceNotFoundError } from "@draft-loop/application";
import type { CandidateRecordAccess } from "@draft-loop/storage/candidate-records";
import type { KnowledgeBaseOwners } from "@draft-loop/storage/knowledge-base-owners";
import type { MemberRole } from "@draft-loop/storage/tenant-directory";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { type KnowledgeOwnership, registerKnowledgeAccess } from "./knowledge-access.js";
import { cloudLoggingOptions } from "./logging.js";

/** Bases by id, each with its owning record; `base-legacy` predates owners. */
const baseOwners = new Map<string, string | undefined>([
  ["base-a", "record-a"],
  ["base-b", "record-b"],
  ["base-legacy", undefined],
]);

/** Records that exist; `record-broken` fails to read for another reason. */
const existingRecords = new Set(["record-a", "record-b"]);

function fakeOwners(overrides: Partial<KnowledgeBaseOwners> = {}): KnowledgeBaseOwners {
  return {
    setOwner: vi.fn(async (input) => ({ ...input, recordedAt: "2026-01-01T00:00:00.000Z" })),
    ownerOf: async (id) => baseOwners.get(id),
    basesOwnedBy: async (records) =>
      [...baseOwners]
        .filter(([, owner]) => owner !== undefined && records.includes(owner))
        .map(([id]) => id)
        .sort(),
    removeUnowned: vi.fn(async () => true),
    ...overrides,
  };
}

const recordAccess = {
  listMemberRecords: async (memberId: string) =>
    memberId === "member-a" ? [{ workspaceId: "record-a" }] : [],
} as unknown as CandidateRecordAccess;

const service = {
  readWorkspace: async (root: string) => {
    if (root === "root/record-broken") throw new Error("Disk unavailable.");
    if (!existingRecords.has(root.replace("root/", ""))) throw new WorkspaceNotFoundError(root);
    return {};
  },
} as unknown as ApplicationService;

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

/**
 * A server whose caller comes from test headers: `owner`, or a member id with a role. Its
 * stand-in routes answer 200 once the access hook lets them through.
 */
async function knowledgeServer(owners: KnowledgeBaseOwners = fakeOwners()) {
  const lines: string[] = [];
  const server = Fastify({ logger: cloudLoggingOptions({ write: (line) => lines.push(line) }) });
  server.decorateRequest("caller", undefined);
  server.addHook("onRequest", async (request) => {
    const memberId = request.headers["x-test-member"];
    if (request.headers["x-test-owner"] === "yes") request.caller = { kind: "owner" };
    if (typeof memberId !== "string") return;
    const role = (request.headers["x-test-role"] ?? "member") as MemberRole;
    request.caller = { kind: "member", tenantId: "tenant-1", memberId, role };
  });
  const ownership: KnowledgeOwnership = registerKnowledgeAccess(server, {
    knowledgeOwnersFor: () => owners,
    recordAccessFor: () => recordAccess,
    service,
    workspaceRoot: (workspaceId) => `root/${workspaceId}`,
  });
  server.get("/v1/knowledge-bases/:knowledgeBaseId", async () => ({ ok: true }));
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
  server.put("/v1/workspaces/:workspaceId/knowledge-selection", async () => ({ ok: true }));
  app = server;
  const refusals = () =>
    lines
      .map((line) => JSON.parse(line) as { accessRefusal?: unknown })
      .flatMap((entry) => (entry.accessRefusal === undefined ? [] : [entry.accessRefusal]));
  return { server, refusals };
}

function member(memberId: string, role: MemberRole = "member") {
  return { "x-test-member": memberId, "x-test-role": role };
}

describe("registerKnowledgeAccess", () => {
  it("lets a member reach their record's base and answers another's as unknown, logged", async () => {
    const { server, refusals } = await knowledgeServer();

    const own = await server.inject({
      url: "/v1/knowledge-bases/base-a",
      headers: member("member-a"),
    });
    const foreign = await server.inject({
      url: "/v1/knowledge-bases/base-b",
      headers: member("member-a"),
    });

    expect(own.statusCode).toBe(200);
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json()).toEqual({
      error: { code: "knowledge_base_not_found", message: "No such knowledge base." },
    });
    expect(refusals()).toEqual([
      {
        resource: "knowledge-base",
        reason: "unassigned",
        tenantId: "tenant-1",
        memberId: "member-a",
        resourceId: "base-b",
      },
    ]);
  });

  it("answers an ownerless or missing base as unknown to a member without logging a refusal", async () => {
    const { server, refusals } = await knowledgeServer();

    const legacy = await server.inject({
      url: "/v1/knowledge-bases/base-legacy",
      headers: member("member-a"),
    });
    const missing = await server.inject({
      url: "/v1/knowledge-bases/base-none",
      headers: member("member-a"),
    });

    expect([legacy.statusCode, missing.statusCode]).toEqual([404, 404]);
    expect(refusals()).toEqual([]);
  });

  it("lets admins, owners and the owner token reach every base", async () => {
    const { server } = await knowledgeServer();

    const admin = await server.inject({
      url: "/v1/knowledge-bases/base-b",
      headers: member("member-x", "admin"),
    });
    const owner = await server.inject({
      url: "/v1/knowledge-bases/base-legacy",
      headers: member("member-y", "owner"),
    });
    const token = await server.inject({
      url: "/v1/knowledge-bases/base-b",
      headers: { "x-test-owner": "yes" },
    });

    expect([admin.statusCode, owner.statusCode, token.statusCode]).toEqual([200, 200, 200]);
  });

  it("requires a new base to name its record", async () => {
    const { server } = await knowledgeServer();

    const response = await server.inject({
      method: "POST",
      url: "/v1/knowledge-bases",
      headers: member("member-a"),
      payload: { name: "Placeholder base" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: "invalid_request", issues: [{ path: "/workspaceId" }] },
    });
  });

  it("creates a base only for a record the member reaches and that exists", async () => {
    const owners = fakeOwners();
    const { server, refusals } = await knowledgeServer(owners);
    const create = (workspaceId: string, role: MemberRole = "member") =>
      server.inject({
        method: "POST",
        url: "/v1/knowledge-bases",
        headers: member("member-a", role),
        payload: { workspaceId },
      });

    const own = await create("record-a");
    const unassigned = await create("record-b");
    const unknown = await create("record-none");
    const adminUnknown = await create("record-none", "admin");

    expect(own.statusCode).toBe(200);
    expect(owners.setOwner).toHaveBeenCalledWith({
      knowledgeBaseId: "base-new",
      workspaceId: "record-a",
    });
    for (const refused of [unassigned, unknown, adminUnknown]) {
      expect(refused.statusCode).toBe(404);
      expect(refused.json()).toEqual({
        error: {
          code: "not_found",
          message: "No such workspace.",
          params: { resource: "workspace" },
        },
      });
    }
    // Only the record that exists counts as a refusal; a missing id is a plain 404.
    expect(refusals()).toEqual([
      expect.objectContaining({ resource: "record", reason: "unassigned", resourceId: "record-b" }),
    ]);
  });

  it("fails a create when the record cannot be read, rather than answering 404", async () => {
    const { server } = await knowledgeServer();

    const response = await server.inject({
      method: "POST",
      url: "/v1/knowledge-bases",
      headers: member("member-x", "admin"),
      payload: { workspaceId: "record-broken" },
    });

    expect(response.statusCode).toBe(500);
  });

  it("removes the new base, and reports the owner write's error, when recording its owner fails", async () => {
    const owners = fakeOwners({
      setOwner: vi.fn(async () => {
        throw new Error("Owner write failed.");
      }),
      removeUnowned: vi.fn(async () => {
        throw new Error("Cleanup failed.");
      }),
    });
    const { server } = await knowledgeServer(owners);

    const response = await server.inject({
      method: "POST",
      url: "/v1/knowledge-bases",
      headers: member("member-a"),
      payload: { workspaceId: "record-a" },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ message: "Owner write failed." });
    expect(owners.removeUnowned).toHaveBeenCalledWith("base-new");
  });

  it("selects only the workspace's own bases, logging a selected base of another record", async () => {
    const { server, refusals } = await knowledgeServer();
    const select = (knowledgeBaseIds: unknown, role: MemberRole = "member") =>
      server.inject({
        method: "PUT",
        url: "/v1/workspaces/record-a/knowledge-selection",
        headers: member("member-a", role),
        payload: { knowledgeBaseIds },
      });

    const own = await select(["base-a"]);
    const foreign = await select(["base-a", "base-b", 7]);
    const legacy = await select(["base-legacy"]);
    const adminForeign = await select(["base-b"], "admin");
    const malformed = await select("base-b");

    expect(own.statusCode).toBe(200);
    expect([foreign.statusCode, legacy.statusCode, adminForeign.statusCode]).toEqual([
      404, 404, 404,
    ]);
    expect(foreign.json()).toMatchObject({ error: { code: "knowledge_base_not_found" } });
    // The route's own schema refuses a malformed body; this hook leaves it alone.
    expect(malformed.statusCode).toBe(200);
    expect(refusals()).toEqual([
      expect.objectContaining({ resource: "knowledge-base", resourceId: "base-b" }),
    ]);
  });

  it("lists a member's records' bases and every base, or one record's, to an admin", async () => {
    const { server } = await knowledgeServer();
    const list = async (headers: Record<string, string>, query = "") =>
      (await server.inject({ url: `/v1/knowledge-bases${query}`, headers })).json();

    expect(await list(member("member-a"))).toEqual({ listable: ["base-a"] });
    expect(await list(member("member-a"), "?workspaceId=record-a")).toEqual({
      listable: ["base-a"],
    });
    expect(await list(member("member-a"), "?workspaceId=record-b")).toEqual({ listable: [] });
    expect(await list(member("member-z"))).toEqual({ listable: [] });
    expect(await list(member("member-x", "admin"))).toEqual({ listable: "every" });
    expect(await list(member("member-x", "admin"), "?workspaceId=record-b")).toEqual({
      listable: ["base-b"],
    });
  });

  it("refuses ownership questions without a signed-in member", async () => {
    const { server } = await knowledgeServer();

    const response = await server.inject({
      url: "/v1/knowledge-bases",
      headers: { "x-test-owner": "yes" },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ message: expect.stringContaining("tenant") });
  });
});
