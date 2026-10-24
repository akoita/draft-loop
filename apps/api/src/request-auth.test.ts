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
): Promise<FastifyInstance> {
  app = await buildApi({
    ownerToken,
    auth: {
      mode: "oidc",
      issuer,
      audience,
      webClientId: "draft-loop-web",
      allowHttp: false,
      resolveSignIn,
      keys,
    },
  });
  app.get("/v1/test-caller", async (request) => ({ caller: request.caller ?? null }));
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

  it("forbids a valid token without an active membership", async () => {
    const api = await signInApi(async () => undefined);

    const response = await callerOf(api, `Bearer ${await token()}`);

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: {
        code: "forbidden",
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
