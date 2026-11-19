import type { SignedInMember, TenantDirectory } from "@draft-loop/storage/tenant-directory";
import type { BetaInvites, RedeemBetaInviteResult } from "@draft-loop/storage-postgres";
import type { FastifyInstance } from "fastify";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApi } from "./app.js";
import { readBetaAccountCap } from "./beta-sign-up-routes.js";
import type { IdentityAccounts } from "./identity-accounts.js";
import { legalVersion } from "./legal-pages.js";
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
  stateCounts: vi.fn<BetaInvites["stateCounts"]>(async () => ({
    open: 0,
    revoked: 0,
    redeemed: 0,
  })),
  revoke: vi.fn<BetaInvites["revoke"]>(async ({ inviteId }) => inviteId === "invite-1"),
  redeem,
  redeemedCount: vi.fn(async () => 3),
  operatorCap: vi.fn<BetaInvites["operatorCap"]>(async () => undefined),
  setOperatorCap: vi.fn<BetaInvites["setOperatorCap"]>(async () => undefined),
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

async function api(
  prepareInvitedAccount?: IdentityAccounts["prepareInvitedAccount"],
): Promise<FastifyInstance> {
  app = await buildApi({
    ownerToken,
    auth: signIn,
    directory: {} as TenantDirectory,
    betaInvites: {
      invites,
      cap: 25,
      ...(prepareInvitedAccount === undefined ? {} : { prepareInvitedAccount }),
    },
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

async function signUp(
  server: FastifyInstance,
  authorization: string,
  code = "abcd-efgh",
  acceptedTerms: string | null = legalVersion,
) {
  const response = await server.inject({
    method: "POST",
    url: "/v1/sign-up",
    headers: { authorization },
    payload: acceptedTerms === null ? { code } : { code, accepted_terms: acceptedTerms },
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
      expect.objectContaining({
        code: "abcd-efgh",
        verifiedEmail: "ada@example.test",
        cap: 25,
        termsVersion: legalVersion,
      }),
    );
    expect(assignPlan).toHaveBeenCalledWith(expect.objectContaining({ planId: "beta" }));
  });

  it.each([
    ["absent", null],
    ["outdated", "2020-01-01"],
  ])(
    "refuses the account when the terms acceptance is %s, creating nothing",
    async (_, version) => {
      const server = await api();

      const response = await signUp(
        server,
        `Bearer ${await token("new-person")}`,
        "abcd-efgh",
        version,
      );

      expect(response).toEqual({
        status: 400,
        body: {
          error: {
            code: "terms_not_accepted",
            message: expect.any(String),
            params: { version: legalVersion },
          },
        },
      });
      expect(redeem).not.toHaveBeenCalled();
      expect(assignPlan).not.toHaveBeenCalled();
    },
  );

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
    expect(response.body.error.params).toEqual(
      refusal === "invite_email_mismatch" ? { email: "ada@example.test" } : undefined,
    );
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
    expect(created.json().emailed).toBe(false);

    const listed = await server.inject({
      method: "GET",
      url: "/v1/operator/beta-invites",
      headers: owner,
    });
    expect(listed.json()).toEqual({
      invites: [],
      total: 0,
      counts: { open: 0, revoked: 0, redeemed: 0 },
      redeemed: 3,
      open: 0,
      cap: 25,
      capSource: "deployment",
      deploymentCap: 25,
    });

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

describe("the operator's runtime cap", () => {
  it("sets the cap without a redeploy and lists it with the open invites", async () => {
    const server = await api();
    const owner = { authorization: `Bearer ${ownerToken}` };
    let stored: number | undefined;
    vi.mocked(invites.operatorCap).mockImplementation(async () => stored);
    vi.mocked(invites.setOperatorCap).mockImplementation(async ({ cap }) => {
      stored = cap;
    });
    vi.mocked(invites.list).mockResolvedValue([
      {
        inviteId: "a",
        email: "a@example.test",
        createdAt: "2026-11-18T10:00:00.000Z",
        state: "open",
      },
      {
        inviteId: "b",
        email: "b@example.test",
        createdAt: "2026-11-18T10:00:00.000Z",
        state: "revoked",
      },
    ]);
    vi.mocked(invites.stateCounts).mockResolvedValue({ open: 1, revoked: 1, redeemed: 0 });
    try {
      const set = await server.inject({
        method: "PUT",
        url: "/v1/operator/beta-invites/cap",
        headers: owner,
        payload: { cap: 10 },
      });
      expect(set.statusCode).toBe(200);
      expect(set.json()).toEqual({
        redeemed: 3,
        open: 1,
        cap: 10,
        capSource: "operator",
        deploymentCap: 25,
      });

      const listed = await server.inject({
        method: "GET",
        url: "/v1/operator/beta-invites",
        headers: owner,
      });
      expect(listed.json()).toMatchObject({
        cap: 10,
        capSource: "operator",
        open: 1,
        total: 2,
        counts: { open: 1, revoked: 1, redeemed: 0 },
      });
      const filtered = await server.inject({
        method: "GET",
        url: "/v1/operator/beta-invites?state=revoked&q=b%40&limit=10&offset=10",
        headers: owner,
      });
      expect(filtered.json()).toMatchObject({ total: 1 });
      expect(invites.list).toHaveBeenLastCalledWith({
        limit: 10,
        offset: 10,
        query: "b@",
        state: "revoked",
      });
      expect(invites.stateCounts).toHaveBeenCalledWith("b@");
    } finally {
      vi.mocked(invites.operatorCap).mockReset();
      vi.mocked(invites.setOperatorCap).mockReset();
      vi.mocked(invites.list).mockResolvedValue([]);
      vi.mocked(invites.stateCounts).mockResolvedValue({ open: 0, revoked: 0, redeemed: 0 });
    }
  });

  it("refuses a cap out of range and any caller but the operator", async () => {
    const server = await api();
    const put = (authorization: string, cap: unknown) =>
      server.inject({
        method: "PUT",
        url: "/v1/operator/beta-invites/cap",
        headers: { authorization },
        payload: { cap },
      });
    for (const cap of [-1, 2.5, 100_001, "10"]) {
      expect((await put(`Bearer ${ownerToken}`, cap)).statusCode).toBe(400);
    }
    expect((await put(`Bearer ${await token("member-1")}`, 10)).statusCode).toBe(401);
    expect(invites.setOperatorCap).not.toHaveBeenCalled();
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

describe("preparing sign-ins for open invites (#3082)", () => {
  const openInvite = (n: number) => ({
    inviteId: `invite-${n}`,
    email: `person-${n}@example.test`,
    createdAt: "2026-11-08T10:00:00.000Z",
    state: "open" as const,
  });
  const prepare = (
    url = "/v1/operator/beta-invites/sign-ins",
    authorization = `Bearer ${ownerToken}`,
  ) => app?.inject({ method: "POST", url, headers: { authorization } });

  it("prepares each open invite's sign-in and counts the outcomes", async () => {
    vi.mocked(invites.list).mockResolvedValueOnce([openInvite(1), openInvite(2), openInvite(3)]);
    const prepareInvitedAccount = vi.fn<IdentityAccounts["prepareInvitedAccount"]>(
      async ({ email }) => {
        if (email === "person-2@example.test") return "exists";
        if (email === "person-3@example.test") throw new Error("provider down");
        return "password-email";
      },
    );
    await api(prepareInvitedAccount);

    const response = await prepare();

    expect(response?.statusCode).toBe(200);
    expect(response?.json()).toEqual({ passwordEmails: 1, existing: 1, failed: 1 });
    expect(vi.mocked(invites.list)).toHaveBeenLastCalledWith({ state: "open", limit: 200 });
    expect(prepareInvitedAccount).toHaveBeenCalledTimes(3);
  });

  it("refuses a member's sign-in, and is absent without the account client", async () => {
    await api(vi.fn<IdentityAccounts["prepareInvitedAccount"]>(async () => "exists"));
    expect((await prepare(undefined, `Bearer ${await token("member-1")}`))?.statusCode).toBe(401);
    await app?.close();

    await api();
    expect((await prepare())?.statusCode).toBe(404);
  });
});
