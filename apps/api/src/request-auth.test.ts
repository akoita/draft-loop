import type { FastifyInstance } from "fastify";
import {
  createLocalJWKSet,
  errors,
  exportJWK,
  generateKeyPair,
  type JWK,
  type JWTVerifyGetKey,
  SignJWT,
} from "jose";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { buildApi } from "./app.js";
import type { ResolveSignIn, SignInIdentity } from "./oidc-sign-in.js";
import { isOperatorRequest, operatorRole } from "./request-auth.js";

const ownerToken = "owner-token-for-tests-0123456789abcdef";
const issuer = "https://id.example.test/realms/draft-loop";
const audience = "draft-loop-api";

type KeyPair = Awaited<ReturnType<typeof generateKeyPair>>;
let signingKey: KeyPair;
let publicJwk: JWK;
let app: FastifyInstance | undefined;

beforeAll(async () => {
  signingKey = await generateKeyPair("ES256");
  publicJwk = { ...(await exportJWK(signingKey.publicKey)), kid: "key-1", alg: "ES256" };
});

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function token(claims: Record<string, unknown> = {}): Promise<string> {
  return new SignJWT({ email: "ada@example.test", email_verified: true, ...claims })
    .setProtectedHeader({ alg: "ES256", kid: "key-1" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject("person-1")
    .setExpirationTime("5m")
    .sign(signingKey.privateKey);
}

/** An API in sign-in mode with a route that echoes who called it. */
async function signInApi(
  resolveSignIn: ResolveSignIn,
  keys: JWTVerifyGetKey = createLocalJWKSet({ keys: [publicJwk] }),
  memberClientIds?: readonly string[],
): Promise<FastifyInstance> {
  app = await buildApi({
    ownerToken,
    auth: {
      mode: "oidc",
      issuer,
      audience,
      webClientId: "draft-loop-web",
      ...(memberClientIds === undefined ? {} : { memberClientIds }),
      allowHttp: false,
      resolveSignIn,
      keys,
    },
  });
  app.get("/v1/test-caller", async (request) => ({ caller: request.caller ?? null }));
  app.get("/v1/workspaces/:workspaceId/applications", async (request) => ({
    caller: request.caller ?? null,
    agent: request.agentToken ?? null,
  }));
  return app;
}

async function callerOf(api: FastifyInstance, authorization?: string) {
  return api.inject({
    method: "GET",
    url: "/v1/test-caller",
    ...(authorization === undefined ? {} : { headers: { authorization } }),
  });
}

const member = { tenantId: "org-1", memberId: "member-1", role: "admin" } as const;

describe("sign-in mode", () => {
  it("resolves a valid token to the caller's organisation and role", async () => {
    const identities: SignInIdentity[] = [];
    const api = await signInApi(async (identity) => {
      identities.push(identity);
      return member;
    });

    const response = await callerOf(api, `Bearer ${await token()}`);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ caller: { kind: "member", ...member } });
    expect(identities).toEqual([
      { issuer, subject: "person-1", email: "ada@example.test", emailVerified: true },
    ]);
  });

  it("hands a first sign-in's verified email to the directory, which may admit the person", async () => {
    const api = await signInApi(async (identity) =>
      identity.emailVerified && identity.email === "new@example.test"
        ? { tenantId: "org-1", memberId: "member-new", role: "member" }
        : undefined,
    );

    const admitted = await callerOf(api, `Bearer ${await token({ email: "new@example.test" })}`);
    const unverified = await callerOf(
      api,
      `Bearer ${await token({ email: "new@example.test", email_verified: false })}`,
    );

    expect(admitted.json()).toEqual({
      caller: { kind: "member", tenantId: "org-1", memberId: "member-new", role: "member" },
    });
    expect(unverified.statusCode).toBe(403);
  });

  it("gives a named member client the member's full access, but never a new account", async () => {
    const api = await signInApi(
      async (identity) => (identity.email === "ada@example.test" ? member : undefined),
      createLocalJWKSet({ keys: [publicJwk] }),
      ["draft-loop-smoke"],
    );
    let reached = false;
    api.post("/v1/sign-up", async (request) => {
      reached = request.signUpIdentity !== undefined;
      return {};
    });
    const smoke = await token({ azp: "draft-loop-smoke" });

    const response = await api.inject({
      method: "GET",
      url: "/v1/workspaces/ws-1/applications",
      headers: { authorization: `Bearer ${smoke}` },
    });
    const signUp = await api.inject({
      method: "POST",
      url: "/v1/sign-up",
      headers: {
        authorization: `Bearer ${await token({ azp: "draft-loop-smoke", email: "new@example.test" })}`,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ caller: { kind: "member", ...member }, agent: null });
    expect(signUp.statusCode).toBe(403);
    expect(reached).toBe(false);
  });

  it("forbids a valid token without an active membership", async () => {
    const api = await signInApi(async () => undefined);

    const response = await callerOf(api, `Bearer ${await token()}`);

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: {
        code: "no_account",
        message: "The signed-in account is not a member of an organisation.",
      },
    });
  });

  it.each([
    ["no header", undefined],
    ["the owner token", `Bearer ${ownerToken}`],
    ["a token that is not a JWT", "Bearer not-a-token"],
    ["another scheme", "Basic dXNlcjpwYXNz"],
  ])("refuses %s without asking the directory", async (_label, authorization) => {
    let asked = false;
    const api = await signInApi(async () => {
      asked = true;
      return member;
    });

    const response = await callerOf(api, authorization);

    expect(response.statusCode).toBe(401);
    expect(response.headers["www-authenticate"]).toBe("Bearer");
    expect(response.json()).toEqual({
      error: { code: "unauthorized", message: "A valid sign-in token is required." },
    });
    expect(asked).toBe(false);
  });

  it("refuses a token for another audience", async () => {
    const api = await signInApi(async () => member);
    const other = await new SignJWT({})
      .setProtectedHeader({ alg: "ES256", kid: "key-1" })
      .setIssuer(issuer)
      .setAudience("another-api")
      .setSubject("person-1")
      .setExpirationTime("5m")
      .sign(signingKey.privateKey);

    expect((await callerOf(api, `Bearer ${other}`)).statusCode).toBe(401);
  });

  it("answers 503 when the provider's keys cannot be fetched", async () => {
    const api = await signInApi(
      async () => member,
      async () => {
        throw new errors.JWKSTimeout();
      },
    );

    const response = await callerOf(api, `Bearer ${await token()}`);

    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe("identity_provider_unavailable");
  });

  it("keeps health public", async () => {
    const api = await signInApi(async () => member);

    expect((await api.inject({ method: "GET", url: "/v1/health" })).statusCode).toBe(200);
  });
});

describe("an assistant's sign-in (agent grant)", () => {
  const applications = "/v1/workspaces/ws-1/applications";
  const assistant = { azp: "assistant", scope: "openid draftloop:applications:read" };

  it("acts as the member on an agent route its scopes admit", async () => {
    const api = await signInApi(async () => member);

    const response = await api.inject({
      method: "GET",
      url: applications,
      headers: { authorization: `Bearer ${await token(assistant)}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      caller: { kind: "member", ...member },
      agent: {
        id: expect.stringMatching(/^dlat_oauth_/u),
        workspaceId: "ws-1",
        scopes: ["applications:read"],
        clientId: "assistant",
      },
    });
  });

  it("is refused everywhere else, with or without scopes", async () => {
    const api = await signInApi(async () => member);

    const elsewhere = await callerOf(api, `Bearer ${await token(assistant)}`);
    const unscoped = await api.inject({
      method: "GET",
      url: applications,
      headers: { authorization: `Bearer ${await token({ client_id: "unknown-client" })}` },
    });

    expect(elsewhere.statusCode).toBe(403);
    expect(elsewhere.json()).toMatchObject({ error: { code: "forbidden" } });
    expect(unscoped.statusCode).toBe(403);
  });

  it("leaves the web screen's own sign-in unrestricted", async () => {
    const api = await signInApi(async () => member);

    const web = await callerOf(api, `Bearer ${await token({ azp: "draft-loop-web" })}`);
    const onAgentRoute = await api.inject({
      method: "GET",
      url: applications,
      headers: { authorization: `Bearer ${await token({ azp: "draft-loop-web" })}` },
    });

    expect(web.statusCode).toBe(200);
    expect(onAgentRoute.json()).toMatchObject({ agent: null });
  });

  it("cannot create an account: without a membership it never reaches sign-up", async () => {
    const api = await signInApi(async () => undefined);
    let reached = false;
    api.post("/v1/sign-up", async (request) => {
      reached = request.signUpIdentity !== undefined;
      return {};
    });

    const response = await api.inject({
      method: "POST",
      url: "/v1/sign-up",
      headers: { authorization: `Bearer ${await token(assistant)}` },
    });

    expect(response.statusCode).toBe(403);
    expect(reached).toBe(false);
  });
});

describe("owner mode", () => {
  it("records the owner as the caller", async () => {
    app = await buildApi({ ownerToken, auth: { mode: "owner" } });
    app.get("/v1/test-caller", async (request) => ({ caller: request.caller ?? null }));

    const response = await callerOf(app, `Bearer ${ownerToken}`);

    expect(response.json()).toEqual({ caller: { kind: "owner" } });
  });

  it("refuses a sign-in token", async () => {
    app = await buildApi({ ownerToken });
    app.get("/v1/test-caller", async (request) => ({ caller: request.caller ?? null }));

    expect((await callerOf(app, `Bearer ${await token()}`)).statusCode).toBe(401);
  });
});

describe("operator routes", () => {
  it("are recognised by the matched route or the raw path", () => {
    expect(isOperatorRequest("/v1/operator/organisations", "/v1/operator/organisations")).toBe(
      true,
    );
    expect(isOperatorRequest("/v1/operator/organisations", "/v1/%6Fperator/organisations")).toBe(
      true,
    );
    expect(isOperatorRequest(undefined, "/v1/operator/unknown?x=1")).toBe(true);
    expect(isOperatorRequest("/v1/me", "/v1/me")).toBe(false);
    expect(isOperatorRequest(undefined, "/v1/operators")).toBe(false);
  });

  it("take the owner token in sign-in mode and refuse a member's sign-in", async () => {
    const api = await signInApi(async () => member);
    api.get("/v1/operator/test-caller", async (request) => ({ caller: request.caller ?? null }));

    const operator = await api.inject({
      method: "GET",
      url: "/v1/operator/test-caller",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    const signedIn = await api.inject({
      method: "GET",
      url: "/v1/operator/test-caller",
      headers: { authorization: `Bearer ${await token()}` },
    });

    expect(operator.json()).toEqual({ caller: { kind: "owner" } });
    expect(signedIn.statusCode).toBe(401);
    expect(signedIn.json().error.message).toBe(
      "The operator's token, or an operator's sign-in with a second factor, is required.",
    );
  });

  describe("an operator's sign-in (#2953)", () => {
    const operatorClaims = {
      azp: "draft-loop-web",
      realm_access: { roles: ["default-roles-draft-loop", operatorRole] },
      amr: ["pwd", "otp"],
    };

    const logs: string[] = [];

    async function operatorCall(claims: Record<string, unknown>) {
      logs.length = 0;
      // No membership: the operator need not belong to an organisation.
      app = await buildApi({
        ownerToken,
        logger: { level: "info", stream: { write: (line: string) => logs.push(line) } },
        auth: {
          mode: "oidc",
          issuer,
          audience,
          webClientId: "draft-loop-web",
          allowHttp: false,
          resolveSignIn: async () => undefined,
          keys: createLocalJWKSet({ keys: [publicJwk] }),
        },
      });
      app.get("/v1/operator/test-caller", async (request) => {
        request.log.info("operator read");
        return { caller: request.caller ?? null };
      });
      return app.inject({
        method: "GET",
        url: "/v1/operator/test-caller",
        headers: { authorization: `Bearer ${await token(claims)}` },
      });
    }

    it("acts as the owner, with the person named on the request's log lines", async () => {
      const response = await operatorCall(operatorClaims);

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ caller: { kind: "owner" } });
      const lines = logs.map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(lines.find((line) => line.msg === "operator sign-in accepted")).toMatchObject({
        operatorSubject: "person-1",
        route: "/v1/operator/test-caller",
        methods: ["pwd", "otp"],
      });
      expect(lines.find((line) => line.msg === "operator read")).toMatchObject({
        operatorSubject: "person-1",
      });
    });

    it("is refused without a second factor", async () => {
      expect((await operatorCall({ ...operatorClaims, amr: ["pwd"] })).statusCode).toBe(401);
      expect((await operatorCall({ ...operatorClaims, amr: undefined })).statusCode).toBe(401);
    });

    it("is refused without the operator role", async () => {
      const response = await operatorCall({ ...operatorClaims, realm_access: { roles: [] } });

      expect(response.statusCode).toBe(401);
    });

    it("refuses a member without the role on every route the operator page uses (#2829)", async () => {
      const api = await signInApi(async () => member);
      const memberToken = await token({ ...operatorClaims, realm_access: { roles: [] } });
      const routes = [
        ["GET", "/v1/operator/waitlist"],
        ["POST", "/v1/operator/waitlist/entry-1/invite"],
        ["GET", "/v1/operator/beta-invites"],
        ["GET", "/v1/operator/feedback"],
      ] as const;

      for (const [method, url] of routes) {
        const response = await api.inject({
          method,
          url,
          headers: { authorization: `Bearer ${memberToken}` },
        });
        expect({ url, status: response.statusCode }).toEqual({ url, status: 401 });
      }
    });

    it("is refused from any client but the web screen's", async () => {
      expect((await operatorCall({ ...operatorClaims, azp: "an-assistant" })).statusCode).toBe(401);
      expect((await operatorCall({ ...operatorClaims, azp: undefined })).statusCode).toBe(401);
    });

    it("marks a member's caller as an operator only with the role and a second factor", async () => {
      const api = await signInApi(async () => member);

      const operator = await callerOf(api, `Bearer ${await token(operatorClaims)}`);
      const passwordOnly = await callerOf(
        api,
        `Bearer ${await token({ ...operatorClaims, amr: ["pwd"] })}`,
      );

      expect(operator.json().caller).toEqual({
        kind: "member",
        ...member,
        operator: true,
        holdsOperatorRole: true,
        secondFactor: true,
      });
      // Without the second factor the role still shows, so the account cannot be deleted.
      expect(passwordOnly.json().caller).toEqual({
        kind: "member",
        ...member,
        holdsOperatorRole: true,
      });
    });

    it("gives no operator reach outside operator routes", async () => {
      const api = await signInApi(async () => undefined);

      const response = await callerOf(api, `Bearer ${await token(operatorClaims)}`);

      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe("no_account");
    });
  });
});
