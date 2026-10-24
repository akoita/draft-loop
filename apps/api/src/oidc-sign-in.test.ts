import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import {
  createLocalJWKSet,
  exportJWK,
  exportSPKI,
  generateKeyPair,
  type JWK,
  type JWTPayload,
  SignJWT,
} from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  IdentityProviderUnavailableError,
  isProviderUrl,
  remoteSignInKeys,
  signInTokenVerifier,
} from "./oidc-sign-in.js";

const issuer = "https://id.example.test/realms/draft-loop";
const audience = "draft-loop-api";

type KeyPair = Awaited<ReturnType<typeof generateKeyPair>>;
let signingKey: KeyPair;
let otherKey: KeyPair;
let publicJwk: JWK;

beforeAll(async () => {
  signingKey = await generateKeyPair("RS256");
  otherKey = await generateKeyPair("RS256");
  publicJwk = {
    ...(await exportJWK(signingKey.publicKey)),
    kid: "key-1",
    alg: "RS256",
    use: "sig",
  };
});

interface TokenOptions {
  readonly claims?: JWTPayload;
  readonly issuer?: string;
  readonly audience?: string;
  readonly expiresAt?: number;
  readonly key?: KeyPair;
  readonly kid?: string;
}

function now(): number {
  return Math.floor(Date.now() / 1000);
}

async function token(options: TokenOptions = {}): Promise<string> {
  return new SignJWT({ email: "ada@example.test", email_verified: true, ...options.claims })
    .setProtectedHeader({ alg: "RS256", kid: options.kid ?? "key-1" })
    .setIssuer(options.issuer ?? issuer)
    .setAudience(options.audience ?? audience)
    .setSubject("person-1")
    .setIssuedAt()
    .setExpirationTime(options.expiresAt ?? now() + 300)
    .sign((options.key ?? signingKey).privateKey);
}

function verifier() {
  return signInTokenVerifier({ issuer, audience }, createLocalJWKSet({ keys: [publicJwk] }));
}

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

describe("signInTokenVerifier", () => {
  it("verifies a provider token and reads the person and their verified email", async () => {
    expect(await verifier()(await token())).toEqual({
      status: "verified",
      identity: { issuer, subject: "person-1", email: "ada@example.test", emailVerified: true },
    });
  });

  it("counts an email as verified only when the provider says exactly true", async () => {
    const result = await verifier()(await token({ claims: { email_verified: "true" } }));

    expect(result).toMatchObject({ status: "verified", identity: { emailVerified: false } });
  });

  it("accepts a token that expired within the clock tolerance", async () => {
    expect((await verifier()(await token({ expiresAt: now() - 10 }))).status).toBe("verified");
  });

  it.each([
    ["an expired token", { expiresAt: now() - 120 }, "ERR_JWT_EXPIRED"],
    ["another audience", { audience: "another-api" }, "ERR_JWT_CLAIM_VALIDATION_FAILED"],
    [
      "another issuer",
      { issuer: "https://evil.example.test/realms/draft-loop" },
      "ERR_JWT_CLAIM_VALIDATION_FAILED",
    ],
    ["an unknown key id", { kid: "key-2" }, "ERR_JWKS_NO_MATCHING_KEY"],
  ])("refuses %s", async (_label, options, reason) => {
    const result = await verifier()(await token(options));

    expect(result).toEqual({ status: "refused", reason });
  });

  it("refuses a token signed by another key under a known key id", async () => {
    const result = await verifier()(await token({ key: otherKey }));

    expect(result).toEqual({ status: "refused", reason: "ERR_JWS_SIGNATURE_VERIFICATION_FAILED" });
  });

  it("refuses an unsigned token", async () => {
    const claims = { iss: issuer, aud: audience, sub: "person-1", exp: now() + 300 };
    const unsigned = `${base64url({ alg: "none", kid: "key-1" })}.${base64url(claims)}.`;

    expect((await verifier()(unsigned)).status).toBe("refused");
  });

  it("refuses a token signed with the public key as a shared secret", async () => {
    const secret = new TextEncoder().encode(await exportSPKI(signingKey.publicKey));
    const forged = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256", kid: "key-1" })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject("person-1")
      .setExpirationTime(now() + 300)
      .sign(secret);

    expect(await verifier()(forged)).toEqual({
      status: "refused",
      reason: "ERR_JOSE_ALG_NOT_ALLOWED",
    });
  });

  it("refuses a token without a subject", async () => {
    const anonymous = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid: "key-1" })
      .setIssuer(issuer)
      .setAudience(audience)
      .setExpirationTime(now() + 300)
      .sign(signingKey.privateKey);

    expect((await verifier()(anonymous)).status).toBe("refused");
  });

  it("refuses something that is not a token", async () => {
    expect((await verifier()("not-a-token")).status).toBe("refused");
  });

  it("reports an unreachable provider rather than refusing the token", async () => {
    const verify = signInTokenVerifier({ issuer, audience }, async () => {
      throw new TypeError("fetch failed");
    });

    await expect(verify(await token())).rejects.toBeInstanceOf(IdentityProviderUnavailableError);
  });
});

describe("isProviderUrl", () => {
  it.each([
    ["https://id.example.test/realms/a", false, true],
    ["http://keycloak:8080/realms/a", false, false],
    ["http://keycloak:8080/realms/a", true, true],
    ["https://user:secret@id.example.test/", false, false],
    ["https://id.example.test/#fragment", false, false],
    ["ftp://id.example.test/", true, false],
    ["not a url", true, false],
  ])("judges %s (http allowed: %s)", (url, allowHttp, expected) => {
    expect(isProviderUrl(url, allowHttp)).toBe(expected);
  });
});

describe("remoteSignInKeys", () => {
  let server: Server;
  let base: string;
  let discoveredIssuer: string;
  const requests: string[] = [];

  beforeAll(async () => {
    server = createServer((request, response) => {
      requests.push(request.url ?? "");
      response.setHeader("content-type", "application/json");
      if (request.url === "/realms/local/.well-known/openid-configuration") {
        response.end(
          JSON.stringify({
            issuer: discoveredIssuer,
            jwks_uri: `${base}/realms/local/protocol/openid-connect/certs`,
          }),
        );
        return;
      }
      if (request.url === "/realms/local/protocol/openid-connect/certs") {
        response.end(JSON.stringify({ keys: [publicJwk] }));
        return;
      }
      response.statusCode = 404;
      response.end("{}");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  function localSettings() {
    return {
      issuer: `${base}/realms/local`,
      audience,
      webClientId: "draft-loop-web",
      allowHttp: true,
    };
  }

  it("discovers the provider's keys from its issuer and verifies with them", async () => {
    discoveredIssuer = `${base}/realms/local`;
    requests.length = 0;
    const settings = localSettings();
    const verify = signInTokenVerifier(settings, remoteSignInKeys(settings));

    expect((await verify(await token({ issuer: settings.issuer }))).status).toBe("verified");
    expect((await verify(await token({ issuer: settings.issuer }))).status).toBe("verified");
    expect(requests).toEqual([
      "/realms/local/.well-known/openid-configuration",
      "/realms/local/protocol/openid-connect/certs",
    ]);
  });

  it("uses a configured key address without discovery", async () => {
    requests.length = 0;
    const settings = {
      ...localSettings(),
      jwksUrl: `${base}/realms/local/protocol/openid-connect/certs`,
    };
    const verify = signInTokenVerifier(settings, remoteSignInKeys(settings));

    expect((await verify(await token({ issuer: settings.issuer }))).status).toBe("verified");
    expect(requests).toEqual(["/realms/local/protocol/openid-connect/certs"]);
  });

  it("refuses a discovery document for another issuer", async () => {
    discoveredIssuer = "https://evil.example.test/realms/local";
    const settings = localSettings();
    const verify = signInTokenVerifier(settings, remoteSignInKeys(settings));

    await expect(verify(await token({ issuer: settings.issuer }))).rejects.toBeInstanceOf(
      IdentityProviderUnavailableError,
    );
  });

  it("does not fetch plain-http keys unless the local stack allows them", async () => {
    discoveredIssuer = `${base}/realms/local`;
    const settings = { ...localSettings(), allowHttp: false };
    const verify = signInTokenVerifier(settings, remoteSignInKeys(settings));

    await expect(verify(await token({ issuer: settings.issuer }))).rejects.toBeInstanceOf(
      IdentityProviderUnavailableError,
    );
  });
});
