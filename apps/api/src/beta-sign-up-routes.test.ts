import type { SignedInMember, TenantDirectory } from "@draft-loop/storage/tenant-directory";
import type { BetaInvites, RedeemBetaInviteResult } from "@draft-loop/storage-postgres";
import type { FastifyInstance } from "fastify";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApi } from "./app.js";
import { readBetaAccountCap } from "./beta-sign-up-routes.js";
import type { ApiAuthOptions } from "./request-auth.js";

const ownerToken = "owner-token-for-tests-0123456789abcdef";
const issuer = "https://id.example.test/realms/draft-loop";
const audience = "draft-loop-api";

let signingKey: Awaited<ReturnType<typeof generateKeyPair>>;
let signIn: ApiAuthOptions;
let app: FastifyInstance | undefined;
let claimed: SignedInMember | undefined;
let members: Map<string, SignedInMember>;

const redeem = vi.fn<BetaInvites["redeem"]>();
const assignPlan = vi.fn(async () => ({}) as never);
const touch = vi.fn(async (_organisationId: string, _now: Date) => true);
const invites: BetaInvites = {
  create: vi.fn<BetaInvites["create"]>(async ({ email }) => ({
    invite: { inviteId: "invite-1", email, createdAt: "2026-11-08T10:00:00.000Z", state: "open" },
    code: "ABCDEFGHJKMNPQRS",
  })),
  list: vi.fn<BetaInvites["list"]>(async () => []),
  revoke: vi.fn<BetaInvites["revoke"]>(async ({ inviteId }) => inviteId === "invite-1"),
  redeem,
  redeemedCount: vi.fn(async () => 3),
};

beforeAll(async () => {
  signingKey = await generateKeyPair("ES256");
  const publicJwk = { ...(await exportJWK(signingKey.publicKey)), kid: "key-1", alg: "ES256" };
  signIn = {
    mode: "oidc",
    issuer,
    audience,
    webClientId: "draft-loop-web",
    allowHttp: false,
    keys: createLocalJWKSet({ keys: [publicJwk] }),
    resolveSignIn: async ({ subject }) => members.get(subject) ?? claimed,
  };
});

beforeEach(() => {
  members = new Map([["member-1", { tenantId: "org-north", memberId: "m-1", role: "owner" }]]);
  claimed = undefined;
  redeem.mockReset();
  redeem.mockImplementation(async (): Promise<RedeemBetaInviteResult> => {
    claimed = { tenantId: "beta-org", memberId: "m-new", role: "owner" };
    return { redeemed: true, organisationId: "beta-org", memberId: "m-new" };
  });
  assignPlan.mockClear();
  touch.mockClear();
});

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function api(): Promise<FastifyInstance> {
  app = await buildApi({
    ownerToken,
    auth: signIn,
    directory: {} as TenantDirectory,
    betaInvites: { invites, cap: 25 },
    organisationActivity: { touch },
    tenants: {
      budgetCeiling: { maxRounds: 5, maxCostUsd: 3, maxDurationMs: 1_800_000 },
      // The tenant context composes a member's application; these routes read none of it.
      applicationFor: () => ({}) as never,
      recordAccessFor: () => ({ listRecords: async () => [] }),
      knowledgeOwnersFor: () => ({}),
      entitlementsFor: () => ({}),
      operatorFor: () => ({ plans: { assignPlan }, ledger: {}, idempotency: {} }) as never,
    } as never,
  });
  return app;
}

async function token(subject: string, email = "ada@example.test", verified = true) {
  return new SignJWT({ email, email_verified: verified })
    .setProtectedHeader({ alg: "ES256", kid: "key-1" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject(subject)
    .setExpirationTime("5m")
    .sign(signingKey.privateKey);
}

async function signUp(server: FastifyInstance, authorization: string, code = "abcd-efgh") {
  const response = await server.inject({
    method: "POST",
    url: "/v1/sign-up",
    headers: { authorization },
    payload: { code },
  });
  return { status: response.statusCode, body: response.json() };
}

describe("signing up with a beta invite", () => {
  it("creates the account on the Beta plan and answers with the new membership", async () => {
    const server = await api();

    const response = await signUp(server, `Bearer ${await token("new-person")}`);

    expect(response).toEqual({
      status: 201,
      body: { organisationId: "beta-org", memberId: "m-new", role: "owner" },
    });
    expect(redeem).toHaveBeenCalledWith(
      expect.objectContaining({ code: "abcd-efgh", verifiedEmail: "ada@example.test", cap: 25 }),
    );
    expect(assignPlan).toHaveBeenCalledWith(expect.objectContaining({ planId: "beta" }));
  });

  it.each([
    ["invite_unknown", 404],
    ["invite_used", 409],
    ["invite_email_mismatch", 403],
    ["beta_full", 409],
  ] as const)("answers %s with %i and creates nothing", async (refusal, status) => {
    redeem.mockResolvedValueOnce({ redeemed: false, refusal });
    const server = await api();

    const response = await signUp(server, `Bearer ${await token("new-person")}`);

    expect(response.status).toBe(status);
    expect(response.body.error.code).toBe(refusal);
    expect(assignPlan).not.toHaveBeenCalled();
  });

  it("waits after five refused attempts by one sign-in", async () => {
    redeem.mockResolvedValue({ redeemed: false, refusal: "invite_unknown" });
    const server = await api();
    const authorization = `Bearer ${await token("guesser")}`;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await signUp(server, authorization)).status).toBe(404);
    }
    const limited = await signUp(server, authorization);

    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe("rate_limited");
    expect(redeem).toHaveBeenCalledTimes(5);
  });

  it("refuses a member, an unverified email and the owner token", async () => {
    const server = await api();

    expect((await signUp(server, `Bearer ${await token("member-1")}`)).body.error.code).toBe(
      "already_member",
    );
    const unverified = await signUp(server, `Bearer ${await token("new", "a@x.test", false)}`);
    expect(unverified.status).toBe(403);
    expect((await signUp(server, `Bearer ${ownerToken}`)).status).toBe(401);
    expect(redeem).not.toHaveBeenCalled();
  });

  it("still refuses other routes to a sign-in without an account", async () => {
    const server = await api();

    const response = await server.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: `Bearer ${await token("new-person")}` },
    });

    expect(response.statusCode).toBe(403);
  });
});

describe("organisation activity (#2538)", () => {
  const touched = () => touch.mock.calls.map(([organisationId]) => organisationId);

  it("counts a new account as active from its sign-up", async () => {
    const server = await api();

    await signUp(server, `Bearer ${await token("new-person")}`);

    expect(touched()).toEqual(["beta-org"]);
  });

  it("records a member's requests once an hour, and never the owner token's", async () => {
    const server = await api();
    const member = `Bearer ${await token("member-1")}`;

    await signUp(server, member);
    await signUp(server, member);
    await signUp(server, `Bearer ${ownerToken}`);

    expect(touched()).toEqual(["org-north"]);
  });

  it("keeps answering when the activity write fails", async () => {
    touch.mockRejectedValueOnce(new Error("database unavailable"));
    const server = await api();

    const response = await signUp(server, `Bearer ${await token("member-1")}`);

    expect(response.body.error.code).toBe("already_member");
  });
});

describe("operator beta invite routes", () => {
  it("creates, lists and revokes invites with the owner token only", async () => {
    const server = await api();
    const owner = { authorization: `Bearer ${ownerToken}` };

    const created = await server.inject({
      method: "POST",
      url: "/v1/operator/beta-invites",
      headers: owner,
      payload: { email: "ada@example.test" },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().code).toBe("ABCDEFGHJKMNPQRS");

    const listed = await server.inject({
      method: "GET",
      url: "/v1/operator/beta-invites",
      headers: owner,
    });
    expect(listed.json()).toEqual({ invites: [], redeemed: 3, cap: 25 });

    const revoke = (id: string) =>
      server.inject({ method: "DELETE", url: `/v1/operator/beta-invites/${id}`, headers: owner });
    expect((await revoke("invite-1")).statusCode).toBe(204);
    expect((await revoke("invite-2")).statusCode).toBe(404);

    const member = await server.inject({
      method: "GET",
      url: "/v1/operator/beta-invites",
      headers: { authorization: `Bearer ${await token("member-1")}` },
    });
    expect(member.statusCode).toBe(401);
  });
});

describe("the beta account cap setting", () => {
  it("is closed when unset and refuses anything but a whole number", () => {
    expect(readBetaAccountCap({})).toBe(0);
    expect(readBetaAccountCap({ DRAFT_LOOP_BETA_ACCOUNT_CAP: "25" })).toBe(25);
    expect(() => readBetaAccountCap({ DRAFT_LOOP_BETA_ACCOUNT_CAP: "-1" })).toThrow();
    expect(() => readBetaAccountCap({ DRAFT_LOOP_BETA_ACCOUNT_CAP: "2.5" })).toThrow();
  });
});
