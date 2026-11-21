import { createLocalJWKSet, exportJWK, generateKeyPair, type JWTVerifyGetKey, SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";

import { IssuerUnavailableError, remoteTokenChecker } from "./remote-token.js";

const oauth = {
  resource: "https://draftloop.example.test/mcp",
  issuer: "https://id.example.test/realms/draft-loop",
};

let keys: JWTVerifyGetKey;
let sign: (claims: Record<string, unknown>) => Promise<string>;

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  keys = createLocalJWKSet({
    keys: [{ ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256" }],
  });
  sign = (claims) => {
    const jwt = new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuedAt();
    return (claims.exp === undefined ? jwt.setExpirationTime("5m") : jwt).sign(privateKey);
  };
});

const member = {
  iss: oauth.issuer,
  aud: ["draft-loop-api", oauth.resource],
  sub: "person-1",
  scope: "openid draftloop:journal draftloop:applications:read",
};

describe("remoteTokenChecker", () => {
  it("accepts a current token for this server and reads its scopes", async () => {
    expect(await remoteTokenChecker(oauth, keys)(await sign(member))).toEqual({
      status: "accepted",
      scopes: ["openid", "draftloop:journal", "draftloop:applications:read"],
    });
  });

  it("refuses a token issued for another audience, even the API alone", async () => {
    const check = remoteTokenChecker(oauth, keys);

    for (const aud of ["draft-loop-api", "https://other.example.test/mcp", `${oauth.resource}/`]) {
      expect(await check(await sign({ ...member, aud }))).toMatchObject({ status: "refused" });
    }
  });

  it("refuses another issuer, another key, a missing subject and a bad signature", async () => {
    const check = remoteTokenChecker(oauth, keys);
    const otherKey = await new SignJWT(member)
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setExpirationTime("5m")
      .sign((await generateKeyPair("RS256")).privateKey);
    const { sub: _sub, ...anonymous } = member;
    const valid = await sign(member);
    const tampered = `${valid.slice(0, -4)}AAAA`;

    expect(await check(await sign({ ...member, iss: "https://evil.example.test" }))).toEqual({
      status: "refused",
      reason: "ERR_JWT_CLAIM_VALIDATION_FAILED",
    });
    expect(await check(otherKey)).toMatchObject({ status: "refused" });
    expect(await check(await sign(anonymous))).toMatchObject({ status: "refused" });
    expect(await check(tampered)).toMatchObject({ status: "refused" });
    expect(await check("not-a-token")).toMatchObject({ status: "refused" });
  });

  it("refuses an expired token signed by the issuer's own key", async () => {
    const check = remoteTokenChecker(oauth, keys);
    const past = Math.floor(Date.now() / 1000) - 3_600;

    expect(await check(await sign({ ...member, exp: past }))).toEqual({
      status: "refused",
      reason: "ERR_JWT_EXPIRED",
    });
  });

  it("throws when the issuer's keys cannot be had, rather than refusing the person", async () => {
    const check = remoteTokenChecker(oauth, async () => {
      throw new TypeError("fetch failed");
    });

    await expect(check(await sign(member))).rejects.toBeInstanceOf(IssuerUnavailableError);
  });
});
