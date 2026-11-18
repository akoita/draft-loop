import { defaultHostedKnowledgeSourceMaxBytes } from "@draft-loop/application";
import type { TenantDirectory } from "@draft-loop/storage/tenant-directory";
import type { BetaInvites, BetaWaitlist } from "@draft-loop/storage-postgres";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { apiBodyLimitBytes, buildApi } from "./app.js";
import { waitlistPath } from "./beta-waitlist-routes.js";
import { clientErrorBodyLimitBytes, clientErrorsPath } from "./client-error-routes.js";
import { maximumSourceBytesLimit } from "./config.js";
import { signUpRoute } from "./request-auth.js";

/**
 * The public surface in sign-in mode (#2936): the routes anyone can reach without an account
 * (sign-up, the waitlist, browser error reports) refuse oversized and malformed bodies, and every
 * answer carries the security headers, no CORS grant and no cookie. The payment webhook's own
 * limits are in payment-event-routes.test.ts; rate limits are in each route's own test.
 */

const ownerToken = "owner-token-for-tests-0123456789abcdef";
const issuer = "https://id.example.test/realms/draft-loop";
const audience = "draft-loop-api";

let app: FastifyInstance;
let signedIn: string;
const redeem = vi.fn<BetaInvites["redeem"]>();
const join = vi.fn<BetaWaitlist["join"]>(async () => true);

beforeAll(async () => {
  const signingKey = await generateKeyPair("ES256");
  const publicJwk = { ...(await exportJWK(signingKey.publicKey)), kid: "key-1", alg: "ES256" };
  signedIn = await new SignJWT({ email: "ada@example.test", email_verified: true })
    .setProtectedHeader({ alg: "ES256", kid: "key-1" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject("new-person")
    .setExpirationTime("5m")
    .sign(signingKey.privateKey);
  app = await buildApi({
    ownerToken,
    auth: {
      mode: "oidc",
      issuer,
      audience,
      webClientId: "draft-loop-web",
      allowHttp: false,
      keys: createLocalJWKSet({ keys: [publicJwk] }),
      resolveSignIn: async () => undefined,
    },
    directory: {} as TenantDirectory,
    betaInvites: {
      invites: {
        create: vi.fn(),
        list: vi.fn(async () => []),
        stateCounts: vi.fn(async () => ({ open: 0, revoked: 0, redeemed: 0 })),
        revoke: vi.fn(),
        redeem,
        redeemedCount: vi.fn(async () => 0),
        operatorCap: vi.fn(async () => undefined),
        setOperatorCap: vi.fn(),
      } as BetaInvites,
      cap: 25,
    },
    betaWaitlist: {
      join,
      list: vi.fn(async () => []),
      count: vi.fn(async () => 0),
      invite: vi.fn(),
      deleteJoinedBefore: vi.fn(async () => 0),
      joinUnconfirmed: vi.fn(async () => "skip" as const),
      confirm: vi.fn(async () => false),
      deleteUnconfirmedBefore: vi.fn(async () => 0),
    } as BetaWaitlist,
    tenants: {
      budgetCeiling: { maxRounds: 5, maxCostUsd: 3, maxDurationMs: 1_800_000 },
      applicationFor: () => ({}) as never,
      recordAccessFor: () => ({ listRecords: async () => [] }),
      knowledgeOwnersFor: () => ({}),
      entitlementsFor: () => ({}),
    } as never,
  });
});

afterAll(async () => {
  await app.close();
});

const post = (url: string, payload: string, headers: Record<string, string> = {}) =>
  app.inject({
    method: "POST",
    url,
    headers: { "content-type": "application/json", ...headers },
    payload,
    remoteAddress: "203.0.113.20",
  });

/** A JSON object padded with one string field past the given size. */
const padded = (bytes: number, field = "email") => JSON.stringify({ [field]: "x".repeat(bytes) });

describe("public routes refuse oversized and malformed bodies (#2936)", () => {
  it("refuses a body over each route's limit with 413, before the route runs", async () => {
    const sizes: [string, number, Record<string, string>][] = [
      [waitlistPath, 2 * 1024, {}],
      [clientErrorsPath, clientErrorBodyLimitBytes, {}],
      [signUpRoute, apiBodyLimitBytes, { authorization: `Bearer ${signedIn}` }],
    ];
    for (const [url, limit, headers] of sizes) {
      const response = await post(url, padded(limit + 1), headers);
      expect(response.statusCode, url).toBe(413);
    }
    expect(join).not.toHaveBeenCalled();
    expect(redeem).not.toHaveBeenCalled();
  });

  it("refuses unknown fields and wrong types with 400", async () => {
    const cases: [string, unknown, Record<string, string>][] = [
      [waitlistPath, { email: "ada@example.test", consent: true, role: "admin" }, {}],
      [waitlistPath, { email: ["ada@example.test"], consent: true }, {}],
      [signUpRoute, { code: "ABCD", plan: "business" }, { authorization: `Bearer ${signedIn}` }],
      [signUpRoute, { code: 12 }, { authorization: `Bearer ${signedIn}` }],
      [clientErrorsPath, { kind: "error", message: "x", extra: "y" }, {}],
    ];
    for (const [url, body, headers] of cases) {
      const response = await post(url, JSON.stringify(body), headers);
      expect(response.statusCode, `${url} ${JSON.stringify(body)}`).toBe(400);
      expect(response.json().error.code).toBe("invalid_request");
    }
    expect(join).not.toHaveBeenCalled();
    expect(redeem).not.toHaveBeenCalled();
  });

  it("refuses a body that is not JSON without echoing it", async () => {
    const response = await post(waitlistPath, "{<script>alert(1)</script>");
    expect(response.statusCode).toBe(400);
    expect(response.body).not.toContain("<script>");
  });
});

describe("headers, CORS and cookies in sign-in mode (#2936)", () => {
  const answers = async (): Promise<[string, LightMyRequestResponse][]> => [
    ["health", await app.inject({ method: "GET", url: "/v1/health" })],
    ["auth config", await app.inject({ method: "GET", url: "/v1/auth/config" })],
    ["refusal", await app.inject({ method: "GET", url: "/v1/workspaces" })],
    ["unknown route", await app.inject({ method: "GET", url: "/v1/unknown" })],
    [
      "waitlist",
      await post(waitlistPath, JSON.stringify({ email: "b@example.test", consent: true })),
    ],
    ["schema refusal", await post(waitlistPath, "{}")],
  ];

  it("sends the security headers on every answer, refusals included", async () => {
    for (const [label, response] of await answers()) {
      expect(response.headers["x-content-type-options"], label).toBe("nosniff");
      expect(String(response.headers["strict-transport-security"]), label).toContain("max-age=");
      expect(response.headers["referrer-policy"], label).toBe("no-referrer");
      expect(response.headers["x-frame-options"], label).toBe("SAMEORIGIN");
      const policy = String(response.headers["content-security-policy"]);
      expect(policy, label).toContain("frame-ancestors 'none'");
      expect(policy, label).toContain("default-src 'self'");
      expect(response.headers["x-powered-by"], label).toBeUndefined();
    }
  });

  it("sets no cookie: credentials travel only as bearer tokens", async () => {
    for (const [label, response] of await answers()) {
      expect(response.headers["set-cookie"], label).toBeUndefined();
    }
  });

  it("grants no cross-origin access, to a preflight or to a request", async () => {
    const preflight = await app.inject({
      method: "OPTIONS",
      url: waitlistPath,
      headers: {
        origin: "https://attacker.example",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type",
      },
    });
    const request = await app.inject({
      method: "GET",
      url: "/v1/health",
      headers: { origin: "https://attacker.example" },
    });
    for (const response of [preflight, request]) {
      expect(response.headers["access-control-allow-origin"]).toBeUndefined();
      expect(response.headers["access-control-allow-credentials"]).toBeUndefined();
    }
  });
});

describe("upload limits match the documented ones (#2936)", () => {
  it("keeps a source upload at 10 MiB by default and at most 30 MiB, as the operations guide says", () => {
    // docs/operations/local-server-stack.md, DRAFT_LOOP_MAX_SOURCE_BYTES; the 413 itself is in
    // knowledge-routes.test.ts.
    expect(defaultHostedKnowledgeSourceMaxBytes).toBe(10 * 1024 * 1024);
    expect(maximumSourceBytesLimit).toBe(30 * 1024 * 1024);
  });
});
