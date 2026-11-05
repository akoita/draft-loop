import { type ApplicationService, WorkspaceNotFoundError } from "@draft-loop/application";
import type { CandidateRecordAccess } from "@draft-loop/storage/candidate-records";
import type { MemberRole } from "@draft-loop/storage/tenant-directory";
import Fastify, { type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { afterEach, describe, expect, it, vi } from "vitest";

import { cloudLoggingOptions } from "./logging.js";
import { reachesEveryRecord, registerRecordAccess } from "./record-access.js";

/** Records that exist; `record-broken` fails to read for another reason. */
const existingRecords = new Set(["record-a", "record-b"]);

const service = {
  readWorkspace: async (root: string) => {
    if (root === "root/record-broken") throw new Error("Disk unavailable.");
    if (!existingRecords.has(root.replace("root/", ""))) throw new WorkspaceNotFoundError(root);
    return {};
  },
} as unknown as ApplicationService;

/** `member-a` holds `record-a`, twice over to show listings drop repeats; a claim succeeds once. */
function fakeAccess(claimable: boolean) {
  const assignment = (workspaceId: string) => ({
    workspaceId,
    memberId: "member-a",
    assignedAt: "2026-01-01T00:00:00.000Z",
  });
  return {
    assignCreator: vi.fn(async ({ workspaceId }: { workspaceId: string }) =>
      claimable ? assignment(workspaceId) : undefined,
    ),
    unassignMember: vi.fn(async () => true),
    listMemberRecords: async (memberId: string) =>
      memberId === "member-a" ? [assignment("record-z"), assignment("record-a")] : [],
    listRecords: async () => ["record-a", "record-b"],
  };
}

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

/**
 * A server whose caller comes from test headers: `x-test-owner`, or a member id and role. Its
 * stand-in routes answer once record access lets them through; creating answers the status the
 * test asks for.
 */
async function recordServer(
  options: { readonly claimable?: boolean; readonly ownerTenantId?: string } = {},
) {
  const access = fakeAccess(options.claimable ?? true);
  const lines: string[] = [];
  const server = Fastify({ logger: cloudLoggingOptions({ write: (line) => lines.push(line) }) });
  server.setValidatorCompiler(validatorCompiler);
  server.setSerializerCompiler(serializerCompiler);
  server.decorateRequest("caller", undefined);
  server.addHook("onRequest", async (request) => {
    const memberId = request.headers["x-test-member"];
    if (request.headers["x-test-owner"] === "yes") request.caller = { kind: "owner" };
    if (typeof memberId !== "string") return;
    const role = (request.headers["x-test-role"] ?? "member") as MemberRole;
    request.caller = { kind: "member", tenantId: "tenant-1", memberId, role };
  });
  registerRecordAccess(server, {
    recordAccessFor: () => access as unknown as CandidateRecordAccess,
    ...(options.ownerTenantId === undefined ? {} : { ownerTenantId: options.ownerTenantId }),
    service,
    workspaceRoot: (workspaceId) => `root/${workspaceId}`,
  });
  server.get("/v1/workspaces/:workspaceId/runs", async () => ({ ok: true }));
  server.put("/v1/workspaces/:workspaceId", async (request, reply) => {
    const status = Number(request.headers["x-test-status"] ?? "201");
    return reply.code(status).send({ ok: status === 201 });
  });
  app = server;
  const refusals = () =>
    lines
      .map((line) => JSON.parse(line) as { accessRefusal?: { resourceId: string } })
      .flatMap((entry) => (entry.accessRefusal === undefined ? [] : [entry.accessRefusal]));
  return { server, access, refusals };
}

function member(memberId: string, role: MemberRole = "member") {
  return { "x-test-member": memberId, "x-test-role": role };
}

describe("reachesEveryRecord", () => {
  it("is true for the owner token, owners and admins, and false for a member", () => {
    const signedIn = (role: MemberRole) =>
      ({ kind: "member", tenantId: "tenant-1", memberId: "member-1", role }) as const;

    expect(reachesEveryRecord({ kind: "owner" })).toBe(true);
    expect(reachesEveryRecord(signedIn("owner"))).toBe(true);
    expect(reachesEveryRecord(signedIn("admin"))).toBe(true);
    expect(reachesEveryRecord(signedIn("member"))).toBe(false);
  });
});

describe("registerRecordAccess", () => {
  it("lets a member reach an assigned record and answers others as unknown", async () => {
    const { server, refusals } = await recordServer();
    const get = (workspaceId: string, headers: Record<string, string>) =>
      server.inject({ url: `/v1/workspaces/${workspaceId}/runs`, headers });

    const own = await get("record-a", member("member-a"));
    const unassigned = await get("record-b", member("member-a"));
    const missing = await get("record-none", member("member-a"));
    const admin = await get("record-b", member("member-x", "admin"));
    const token = await get("record-b", { "x-test-owner": "yes" });

    expect([own.statusCode, admin.statusCode, token.statusCode]).toEqual([200, 200, 200]);
    expect([unassigned.statusCode, missing.statusCode]).toEqual([404, 404]);
    expect(unassigned.json()).toEqual({
      error: { code: "not_found", message: "No such workspace." },
    });
    // A missing record is a plain 404, not a refusal.
    expect(refusals()).toEqual([
      expect.objectContaining({ resource: "record", reason: "unassigned", resourceId: "record-b" }),
    ]);
  });

  it("fails rather than answering 404 when the record cannot be read", async () => {
    const { server } = await recordServer();

    const response = await server.inject({
      url: "/v1/workspaces/record-broken/runs",
      headers: member("member-a"),
    });

    expect(response.statusCode).toBe(500);
  });

  it("lets a member create a new record, keeping the assignment once it is created", async () => {
    const { server, access } = await recordServer();

    const response = await server.inject({
      method: "PUT",
      url: "/v1/workspaces/record-new",
      headers: member("member-b"),
    });

    expect(response.statusCode).toBe(201);
    expect(access.assignCreator).toHaveBeenCalledWith({
      workspaceId: "record-new",
      memberId: "member-b",
    });
    expect(access.unassignMember).not.toHaveBeenCalled();
  });

  it("gives the assignment back when the creating request did not create the record", async () => {
    const { server, access } = await recordServer();

    const response = await server.inject({
      method: "PUT",
      url: "/v1/workspaces/record-new",
      headers: { ...member("member-b"), "x-test-status": "400" },
    });

    expect(response.statusCode).toBe(400);
    expect(access.unassignMember).toHaveBeenCalledWith({
      workspaceId: "record-new",
      memberId: "member-b",
    });
  });

  it("puts an existing record for its assignee or an admin, and refuses anyone else", async () => {
    const { server, access, refusals } = await recordServer();
    const put = (workspaceId: string, headers: Record<string, string>) =>
      server.inject({ method: "PUT", url: `/v1/workspaces/${workspaceId}`, headers });

    const assignee = await put("record-a", member("member-a"));
    const admin = await put("record-b", member("member-x", "admin"));
    const other = await put("record-b", member("member-b"));

    expect([assignee.statusCode, admin.statusCode, other.statusCode]).toEqual([201, 201, 404]);
    expect(access.assignCreator).not.toHaveBeenCalled();
    expect(refusals()).toEqual([expect.objectContaining({ resourceId: "record-b" })]);
  });

  it("tells a losing admin creator the record exists, and refuses a losing member", async () => {
    const { server, access } = await recordServer({ claimable: false });
    const put = (role: MemberRole) =>
      server.inject({
        method: "PUT",
        url: "/v1/workspaces/record-new",
        headers: member("member-b", role),
      });

    const admin = await put("admin");
    const plain = await put("member");

    expect(admin.statusCode).toBe(409);
    expect(admin.json()).toEqual({
      error: { code: "workspace_exists", message: "A workspace with this id already exists." },
    });
    expect(plain.statusCode).toBe(404);
    expect(access.unassignMember).not.toHaveBeenCalled();
  });

  it("lists a member's records once each, sorted, and every record to admins and the owner", async () => {
    const { server } = await recordServer({ ownerTenantId: "tenant-owner" });
    const list = async (headers: Record<string, string>) =>
      (await server.inject({ url: "/v1/workspaces", headers })).json();

    expect(await list(member("member-a"))).toEqual({
      workspaces: [{ id: "record-a" }, { id: "record-z" }],
    });
    expect(await list(member("member-b"))).toEqual({ workspaces: [] });
    expect(await list(member("member-x", "owner"))).toEqual({
      workspaces: [{ id: "record-a" }, { id: "record-b" }],
    });
    expect(await list({ "x-test-owner": "yes" })).toEqual({
      workspaces: [{ id: "record-a" }, { id: "record-b" }],
    });
  });

  it("refuses a listing without a tenant", async () => {
    const { server } = await recordServer();

    const anonymous = await server.inject({ url: "/v1/workspaces" });
    const tokenWithoutTenant = await server.inject({
      url: "/v1/workspaces",
      headers: { "x-test-owner": "yes" },
    });

    expect([anonymous.statusCode, tokenWithoutTenant.statusCode]).toEqual([500, 500]);
    expect(anonymous.json()).toMatchObject({ message: "The request has no tenant." });
  });
});
