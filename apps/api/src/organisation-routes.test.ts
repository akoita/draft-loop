import { randomUUID } from "node:crypto";

import {
  type CreatedOrganisation,
  type MemberRecord,
  type MemberRole,
  normalizeMemberEmail,
  requireManagerAuthority,
  requireMemberRole,
  requireOrganisationId,
  requireOrganisationName,
  type SignedInMember,
  type TenantDirectory,
  TenantDirectoryError,
} from "@draft-loop/storage/tenant-directory";
import type { FastifyInstance, InjectOptions } from "fastify";
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWK,
  type JWTVerifyGetKey,
  SignJWT,
} from "jose";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buildApi } from "./app.js";
import { cloudLoggingOptions } from "./logging.js";

const ownerToken = "owner-token-for-tests-0123456789abcdef";
const issuer = "https://id.example.test/realms/draft-loop";
const audience = "draft-loop-api";

/** An in-memory directory that keeps the port's rules and refuses with its error codes. */
function memoryDirectory(): TenantDirectory & {
  add(organisationId: string, email: string, role: MemberRole): MemberRecord;
} {
  const organisations = new Map<string, { name: string; createdAt: string }>();
  const members = new Map<string, MemberRecord[]>();
  const now = () => "2026-10-24T09:00:00.000Z";
  const membersOf = (organisationId: string): MemberRecord[] => {
    const found = members.get(requireOrganisationId(organisationId));
    if (found === undefined) {
      throw new TenantDirectoryError("organisation_not_found", "No such organisation.");
    }
    return found;
  };
  const find = (organisationId: string, memberId: string) => {
    const list = membersOf(organisationId);
    const index = list.findIndex((member) => member.memberId === memberId);
    if (index < 0) {
      throw new TenantDirectoryError("member_not_found", "The organisation has no such member.");
    }
    return { list, index, member: list[index] as MemberRecord };
  };
  const keepAnOwner = (list: readonly MemberRecord[], member: MemberRecord) => {
    if (member.role !== "owner") return;
    if (!list.some((other) => other.role === "owner" && other.memberId !== member.memberId)) {
      throw new TenantDirectoryError("last_owner", "An organisation must keep at least one owner.");
    }
  };
  const invite = (organisationId: string, email: string, role: MemberRole): MemberRecord => {
    const list = membersOf(organisationId);
    const normalized = normalizeMemberEmail(email);
    if (list.some((member) => member.email === normalized)) {
      throw new TenantDirectoryError("member_exists", "That email is already invited.");
    }
    const member: MemberRecord = {
      organisationId,
      memberId: randomUUID(),
      email: normalized,
      role: requireMemberRole(role),
      status: "invited",
      invitedAt: now(),
      updatedAt: now(),
    };
    list.push(member);
    return member;
  };
  const createOrganisation = async (input: {
    organisationId: string;
    name: string;
    firstOwnerEmail: string;
  }): Promise<CreatedOrganisation> => {
    const organisationId = requireOrganisationId(input.organisationId);
    const name = requireOrganisationName(input.name);
    normalizeMemberEmail(input.firstOwnerEmail);
    if (organisations.has(organisationId)) {
      throw new TenantDirectoryError("organisation_exists", "That organisation exists.");
    }
    organisations.set(organisationId, { name, createdAt: now() });
    members.set(organisationId, []);
    return {
      organisation: { organisationId, name, createdAt: now() },
      firstOwner: invite(organisationId, input.firstOwnerEmail, "owner"),
    };
  };
  return {
    resolveSignIn: async () => undefined,
    createOrganisation,
    listMembers: async (organisationId) => [...membersOf(organisationId)],
    inviteMember: async (input) => invite(input.organisationId, input.email, input.role),
    changeRole: async (input) => {
      const { list, index, member } = find(input.organisationId, input.memberId);
      requireManagerAuthority(input.actorRole, member.role, input.role);
      if (input.role !== "owner") keepAnOwner(list, member);
      const changed = { ...member, role: requireMemberRole(input.role), updatedAt: now() };
      list[index] = changed;
      return changed;
    },
    removeMember: async (input) => {
      const { list, index, member } = find(input.organisationId, input.memberId);
      requireManagerAuthority(input.actorRole, member.role);
      keepAnOwner(list, member);
      list.splice(index, 1);
      return member;
    },
    add: (organisationId, email, role) => {
      if (!members.has(organisationId)) {
        organisations.set(organisationId, { name: organisationId, createdAt: now() });
        members.set(organisationId, []);
      }
      return invite(organisationId, email, role);
    },
  };
}

type KeyPair = Awaited<ReturnType<typeof generateKeyPair>>;
let signingKey: KeyPair;
let keys: JWTVerifyGetKey;
let app: FastifyInstance | undefined;
let directory: ReturnType<typeof memoryDirectory>;
let logLines: string[];

beforeAll(async () => {
  signingKey = await generateKeyPair("ES256");
  const publicJwk: JWK = {
    ...(await exportJWK(signingKey.publicKey)),
    kid: "key-1",
    alg: "ES256",
  };
  keys = createLocalJWKSet({ keys: [publicJwk] });
});

beforeEach(() => {
  directory = memoryDirectory();
  logLines = [];
});

afterEach(async () => {
  await app?.close();
  app = undefined;
});

/** A sign-in token whose subject names the member the test's resolver admits. */
async function signIn(memberId: string): Promise<string> {
  const token = await new SignJWT({ email_verified: true })
    .setProtectedHeader({ alg: "ES256", kid: "key-1" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject(memberId)
    .setExpirationTime("5m")
    .sign(signingKey.privateKey);
  return `Bearer ${token}`;
}

async function api(mode: "owner" | "oidc" = "oidc"): Promise<FastifyInstance> {
  app = await buildApi({
    ownerToken,
    directory,
    logger: cloudLoggingOptions({ write: (line) => logLines.push(line) }),
    auth:
      mode === "owner"
        ? { mode: "owner" }
        : {
            mode: "oidc",
            issuer,
            audience,
            webClientId: "draft-loop-web",
            allowHttp: false,
            keys,
            // The subject is the member id; the role is read from the directory.
            resolveSignIn: async ({ subject }): Promise<SignedInMember | undefined> => {
              for (const organisationId of ["org-north", "org-south"]) {
                const member = (await directory.listMembers(organisationId).catch(() => [])).find(
                  (record) => record.memberId === subject,
                );
                if (member !== undefined) {
                  return { tenantId: organisationId, memberId: member.memberId, role: member.role };
                }
              }
              return undefined;
            },
          },
  });
  return app;
}

async function call(server: FastifyInstance, authorization: string, request: InjectOptions) {
  return server.inject({ ...request, headers: { authorization } });
}

function seed() {
  return {
    owner: directory.add("org-north", "owner@north.example.test", "owner"),
    admin: directory.add("org-north", "admin@north.example.test", "admin"),
    member: directory.add("org-north", "member@north.example.test", "member"),
    other: directory.add("org-south", "owner@south.example.test", "owner"),
  };
}

describe("/v1/me", () => {
  it("answers a member's organisation, id, role and email", async () => {
    const { admin } = seed();
    const server = await api();

    const response = await call(server, await signIn(admin.memberId), {
      method: "GET",
      url: "/v1/me",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      kind: "member",
      organisationId: "org-north",
      memberId: admin.memberId,
      role: "admin",
      email: "admin@north.example.test",
    });
  });

  it("answers the owner token as the owner in owner mode", async () => {
    const server = await api("owner");

    const response = await call(server, `Bearer ${ownerToken}`, { method: "GET", url: "/v1/me" });

    expect(response.json()).toEqual({ kind: "owner" });
  });

  it("is not served without a directory", async () => {
    app = await buildApi({ ownerToken });

    const response = await call(app, `Bearer ${ownerToken}`, { method: "GET", url: "/v1/me" });

    expect(response.statusCode).toBe(404);
  });
});

describe("an organisation's members", () => {
  it("are listed to owners and admins of that organisation only", async () => {
    const { owner, admin, member } = seed();
    const server = await api();

    const listed = await call(server, await signIn(admin.memberId), {
      method: "GET",
      url: "/v1/organisation/members",
    });
    const refused = await call(server, await signIn(member.memberId), {
      method: "GET",
      url: "/v1/organisation/members",
    });

    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual({
      organisationId: "org-north",
      members: [owner, admin, member].map((record) => ({
        memberId: record.memberId,
        email: record.email,
        role: record.role,
        status: "invited",
        invitedAt: record.invitedAt,
      })),
    });
    expect(refused.statusCode).toBe(403);
  });

  it("are refused to the owner token, which belongs to no organisation", async () => {
    seed();
    const server = await api("owner");

    const response = await call(server, `Bearer ${ownerToken}`, {
      method: "GET",
      url: "/v1/organisation/members",
    });

    expect(response.statusCode).toBe(403);
  });

  it("are invited by an admin, but only an owner invites an owner", async () => {
    const { owner, admin } = seed();
    const server = await api();
    const invite = (role: MemberRole, email: string) => ({
      method: "POST" as const,
      url: "/v1/organisation/members",
      payload: { email, role },
    });

    const invited = await call(
      server,
      await signIn(admin.memberId),
      invite("member", "New@North.Example.Test"),
    );
    const adminInvitesOwner = await call(
      server,
      await signIn(admin.memberId),
      invite("owner", "boss@north.example.test"),
    );
    const ownerInvitesOwner = await call(
      server,
      await signIn(owner.memberId),
      invite("owner", "boss@north.example.test"),
    );
    const again = await call(
      server,
      await signIn(owner.memberId),
      invite("member", "new@north.example.test"),
    );
    const malformed = await call(
      server,
      await signIn(owner.memberId),
      invite("member", "not-an-email"),
    );

    expect(invited.statusCode).toBe(201);
    expect(invited.json()).toMatchObject({
      email: "new@north.example.test",
      role: "member",
      status: "invited",
    });
    expect(adminInvitesOwner.statusCode).toBe(403);
    expect(ownerInvitesOwner.statusCode).toBe(201);
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe("member_exists");
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json().error.code).toBe("invalid_input");
  });

  it("change role: only an owner grants or takes away the owner role", async () => {
    const { owner, admin, member, other } = seed();
    const server = await api();
    const patch = (memberId: string, role: MemberRole) => ({
      method: "PATCH" as const,
      url: `/v1/organisation/members/${memberId}`,
      payload: { role },
    });

    const promoted = await call(
      server,
      await signIn(admin.memberId),
      patch(member.memberId, "admin"),
    );
    const adminGrantsOwner = await call(
      server,
      await signIn(admin.memberId),
      patch(member.memberId, "owner"),
    );
    const adminDemotesOwner = await call(
      server,
      await signIn(admin.memberId),
      patch(owner.memberId, "admin"),
    );
    const memberTries = await call(
      server,
      await signIn(other.memberId),
      patch(member.memberId, "member"),
    );
    const ownerGrants = await call(
      server,
      await signIn(owner.memberId),
      patch(member.memberId, "owner"),
    );

    expect(promoted.statusCode).toBe(200);
    expect(promoted.json()).toMatchObject({ memberId: member.memberId, role: "admin" });
    expect(adminGrantsOwner.statusCode).toBe(403);
    expect(adminGrantsOwner.json().error.code).toBe("forbidden");
    expect(adminDemotesOwner.statusCode).toBe(403);
    expect(adminDemotesOwner.json().error.code).toBe("forbidden");
    // Another organisation's owner cannot reach this organisation's member.
    expect(memberTries.statusCode).toBe(404);
    expect(ownerGrants.statusCode).toBe(200);
    expect(ownerGrants.json().role).toBe("owner");
  });

  it("change role and removal leave the authority check to the directory", async () => {
    const { admin, member } = seed();
    const second = directory.add("org-north", "second@north.example.test", "member");
    const server = await api();
    // The target becomes an owner after the route would have read it as a member.
    const { changeRole, removeMember } = directory;
    const promoteFirst = async (memberId: string) => {
      const target = (await directory.listMembers("org-north")).find(
        (record) => record.memberId === memberId,
      );
      if (target?.role !== "owner") {
        await changeRole({
          organisationId: "org-north",
          memberId,
          role: "owner",
          actorRole: "owner",
        });
      }
    };
    directory.changeRole = async (input) => {
      await promoteFirst(input.memberId);
      return changeRole(input);
    };
    directory.removeMember = async (input) => {
      await promoteFirst(input.memberId);
      return removeMember(input);
    };

    const demoted = await call(server, await signIn(admin.memberId), {
      method: "PATCH",
      url: `/v1/organisation/members/${member.memberId}`,
      payload: { role: "member" },
    });
    const removed = await call(server, await signIn(admin.memberId), {
      method: "DELETE",
      url: `/v1/organisation/members/${second.memberId}`,
    });

    expect(demoted.statusCode).toBe(403);
    expect(demoted.json().error.code).toBe("forbidden");
    expect(removed.statusCode).toBe(403);
    expect(removed.json().error.code).toBe("forbidden");
    expect((await directory.listMembers("org-north")).map((record) => record.role)).toEqual([
      "owner",
      "admin",
      "owner",
      "owner",
    ]);
  });

  it("keep their last owner", async () => {
    const { owner } = seed();
    const server = await api();

    const demoted = await call(server, await signIn(owner.memberId), {
      method: "PATCH",
      url: `/v1/organisation/members/${owner.memberId}`,
      payload: { role: "admin" },
    });
    const removed = await call(server, await signIn(owner.memberId), {
      method: "DELETE",
      url: `/v1/organisation/members/${owner.memberId}`,
    });

    expect(demoted.statusCode).toBe(409);
    expect(demoted.json().error.code).toBe("last_owner");
    expect(removed.statusCode).toBe(409);
    expect(removed.json().error.code).toBe("last_owner");
  });

  it("are removed by an admin, but only an owner removes an owner", async () => {
    const { owner, admin, member } = seed();
    const second = directory.add("org-north", "second@north.example.test", "owner");
    const server = await api();
    const remove = (memberId: string) => ({
      method: "DELETE" as const,
      url: `/v1/organisation/members/${memberId}`,
    });

    const removed = await call(server, await signIn(admin.memberId), remove(member.memberId));
    const adminRemovesOwner = await call(
      server,
      await signIn(admin.memberId),
      remove(second.memberId),
    );
    const ownerRemovesOwner = await call(
      server,
      await signIn(owner.memberId),
      remove(second.memberId),
    );
    const gone = await call(server, await signIn(owner.memberId), remove(member.memberId));

    expect(removed.statusCode).toBe(204);
    expect(removed.body).toBe("");
    expect(adminRemovesOwner.statusCode).toBe(403);
    expect(ownerRemovesOwner.statusCode).toBe(204);
    expect(gone.statusCode).toBe(404);
    expect((await directory.listMembers("org-north")).map((record) => record.role)).toEqual([
      "owner",
      "admin",
    ]);
  });

  it("are refused to a member whatever the change", async () => {
    const { owner, member } = seed();
    const server = await api();
    const authorization = await signIn(member.memberId);

    const responses = await Promise.all([
      call(server, authorization, {
        method: "POST",
        url: "/v1/organisation/members",
        payload: { email: "x@north.example.test", role: "member" },
      }),
      call(server, authorization, {
        method: "PATCH",
        url: `/v1/organisation/members/${owner.memberId}`,
        payload: { role: "member" },
      }),
      call(server, authorization, {
        method: "DELETE",
        url: `/v1/organisation/members/${owner.memberId}`,
      }),
    ]);

    expect(responses.map((response) => response.statusCode)).toEqual([403, 403, 403]);
  });
});

describe("the operator's organisation creation", () => {
  const create = {
    method: "POST" as const,
    url: "/v1/operator/organisations",
    payload: {
      organisationId: "org-east",
      name: "East",
      firstOwnerEmail: "Lead@East.Example.Test",
    },
  };

  it.each(["owner", "oidc"] as const)("takes the owner token in %s mode", async (mode) => {
    const server = await api(mode);

    const created = await call(server, `Bearer ${ownerToken}`, create);
    const again = await call(server, `Bearer ${ownerToken}`, create);

    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      organisation: { organisationId: "org-east", name: "East" },
      firstOwner: { email: "lead@east.example.test", role: "owner", status: "invited" },
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe("organisation_exists");
  });

  it("refuses a member's sign-in, even an owner's", async () => {
    const { owner } = seed();
    const server = await api();

    const response = await call(server, await signIn(owner.memberId), create);

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: { code: "unauthorized", message: "The operator's token is required." },
    });
    await expect(directory.listMembers("org-east")).rejects.toThrow(TenantDirectoryError);
  });

  it("keeps the owner token refused on member routes in sign-in mode", async () => {
    const server = await api();

    const response = await call(server, `Bearer ${ownerToken}`, { method: "GET", url: "/v1/me" });

    expect(response.statusCode).toBe(401);
  });
});

describe("membership changes", () => {
  it("log one content-free line each, with ids and the role but never an email or a token", async () => {
    const { owner, member } = seed();
    const server = await api();
    const authorization = await signIn(owner.memberId);

    await call(server, `Bearer ${ownerToken}`, {
      method: "POST",
      url: "/v1/operator/organisations",
      payload: {
        organisationId: "org-east",
        name: "East",
        firstOwnerEmail: "lead@east.example.test",
      },
    });
    const invited = await call(server, authorization, {
      method: "POST",
      url: "/v1/organisation/members",
      payload: { email: "new@north.example.test", role: "member" },
    });
    await call(server, authorization, {
      method: "PATCH",
      url: `/v1/organisation/members/${member.memberId}`,
      payload: { role: "admin" },
    });
    await call(server, authorization, {
      method: "DELETE",
      url: `/v1/organisation/members/${member.memberId}`,
    });

    const audits = logLines
      .map((line) => JSON.parse(line) as { audit?: Record<string, unknown> })
      .flatMap((line) => (line.audit === undefined ? [] : [line.audit]));
    expect(audits).toEqual([
      expect.objectContaining({
        action: "organisation_created",
        organisationId: "org-east",
        role: "owner",
      }),
      {
        action: "member_invited",
        organisationId: "org-north",
        memberId: invited.json().memberId,
        role: "member",
      },
      {
        action: "member_role_changed",
        organisationId: "org-north",
        memberId: member.memberId,
        role: "admin",
      },
      {
        action: "member_removed",
        organisationId: "org-north",
        memberId: member.memberId,
        role: "admin",
      },
    ]);
    const raw = logLines.join("\n");
    expect(raw).not.toMatch(/@[a-z]+\.example\.test/u);
    expect(raw).not.toContain(ownerToken);
    expect(raw).not.toContain(authorization.slice("Bearer ".length));
  });
});
