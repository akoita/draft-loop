import { describe, expect, it } from "vitest";

import {
  authorizationUrl,
  codeChallenge,
  codeExchangeBody,
  createCodeVerifier,
  discoveryUrl,
  endSessionUrl,
  isExpectedState,
  needsRefresh,
  parseDiscovery,
  parseStoredTokens,
  parseTokenResponse,
  readAuthorizationResponse,
  refreshBody,
} from "./oidc-model.js";

const issuer = "https://id.example.test/realms/draft-loop";
const now = Date.UTC(2026, 9, 24, 12);

describe("PKCE", () => {
  it("makes a 43-character verifier from the unreserved set, different each time", () => {
    const first = createCodeVerifier(globalThis.crypto);

    expect(first).toMatch(/^[A-Za-z0-9\-._~]{43}$/u);
    expect(createCodeVerifier(globalThis.crypto)).not.toBe(first);
  });

  it("derives the S256 challenge of RFC 7636's example", async () => {
    expect(
      await codeChallenge(globalThis.crypto.subtle, "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
    ).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
});

describe("discovery", () => {
  const document = {
    issuer,
    authorization_endpoint: `${issuer}/protocol/openid-connect/auth`,
    token_endpoint: `${issuer}/protocol/openid-connect/token`,
    end_session_endpoint: `${issuer}/protocol/openid-connect/logout`,
  };

  it("reads the endpoints from the issuer's document", () => {
    expect(discoveryUrl(`${issuer}/`)).toBe(`${issuer}/.well-known/openid-configuration`);
    expect(parseDiscovery(document, issuer)).toEqual({
      authorizationEndpoint: document.authorization_endpoint,
      tokenEndpoint: document.token_endpoint,
      endSessionEndpoint: document.end_session_endpoint,
    });
  });

  it("refuses a document for another issuer or with unusable endpoints", () => {
    expect(() => parseDiscovery({ ...document, issuer: "https://other.test" }, issuer)).toThrow(
      "another issuer",
    );
    expect(() =>
      parseDiscovery({ ...document, token_endpoint: "http://id.example.test/token" }, issuer),
    ).toThrow("no usable sign-in endpoints");
    expect(() => parseDiscovery({ issuer }, issuer)).toThrow("no usable sign-in endpoints");
  });

  it("accepts plain-http endpoints for a plain-http issuer, as on the local stack", () => {
    const local = "http://127.0.0.1:58081/realms/draft-loop-local";
    const endpoints = parseDiscovery(
      {
        issuer: local,
        authorization_endpoint: `${local}/auth`,
        token_endpoint: `${local}/token`,
      },
      local,
    );

    expect(endpoints).toEqual({
      authorizationEndpoint: `${local}/auth`,
      tokenEndpoint: `${local}/token`,
    });
  });
});

describe("authorization request", () => {
  it("asks for a code with PKCE S256 and the state", () => {
    const url = new URL(
      authorizationUrl(`${issuer}/protocol/openid-connect/auth`, {
        clientId: "draft-loop-web",
        redirectUri: "https://draftloop.example.test/",
        state: "synthetic-state",
        codeChallenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
      }),
    );

    expect(`${url.origin}${url.pathname}`).toBe(`${issuer}/protocol/openid-connect/auth`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code",
      client_id: "draft-loop-web",
      redirect_uri: "https://draftloop.example.test/",
      scope: "openid email profile",
      state: "synthetic-state",
      code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
      code_challenge_method: "S256",
    });
  });

  it("reads the provider's answer at the screen's address", () => {
    expect(readAuthorizationResponse("?code=abc&state=s1&session_state=x")).toEqual({
      kind: "code",
      code: "abc",
      state: "s1",
    });
    expect(readAuthorizationResponse("?error=access_denied&state=s1")).toEqual({
      kind: "error",
      error: "access_denied",
      state: "s1",
    });
    expect(readAuthorizationResponse("")).toBeUndefined();
    expect(readAuthorizationResponse("?code=abc")).toBeUndefined();
  });

  it("refuses a state this tab did not send", () => {
    expect(isExpectedState("s1", "s1")).toBe(true);
    expect(isExpectedState("s1", "s2")).toBe(false);
    expect(isExpectedState(undefined, "s1")).toBe(false);
    expect(isExpectedState("", "")).toBe(false);
  });
});

describe("token requests", () => {
  it("exchanges the code with the verifier, as a public client", () => {
    expect(
      Object.fromEntries(
        codeExchangeBody({
          clientId: "draft-loop-web",
          code: "abc",
          redirectUri: "https://draftloop.example.test/",
          codeVerifier: "verifier",
        }),
      ),
    ).toEqual({
      grant_type: "authorization_code",
      client_id: "draft-loop-web",
      code: "abc",
      redirect_uri: "https://draftloop.example.test/",
      code_verifier: "verifier",
    });
    expect(refreshBody({ clientId: "draft-loop-web", refreshToken: "refresh-1" }).toString()).toBe(
      "grant_type=refresh_token&client_id=draft-loop-web&refresh_token=refresh-1",
    );
  });

  it("reads the tokens and when the access token expires", () => {
    expect(
      parseTokenResponse(
        { access_token: "access-1", token_type: "Bearer", expires_in: 300, refresh_token: "r-1" },
        now,
      ),
    ).toEqual({ accessToken: "access-1", refreshToken: "r-1", expiresAt: now + 300_000 });
  });

  it("keeps the previous refresh token when a refresh answer has none", () => {
    expect(parseTokenResponse({ access_token: "access-2", expires_in: 60 }, now, "r-1")).toEqual({
      accessToken: "access-2",
      refreshToken: "r-1",
      expiresAt: now + 60_000,
    });
  });

  it.each([
    [{}, "no access token"],
    [{ access_token: "a", token_type: "DPoP", expires_in: 60 }, "does not take"],
    [{ access_token: "a" }, "when the token expires"],
    [{ access_token: "a", expires_in: -1 }, "when the token expires"],
  ])("refuses the token answer %j", (body, message) => {
    expect(() => parseTokenResponse(body, now)).toThrow(message);
  });

  it("refreshes 30 seconds before expiry", () => {
    const tokens = { accessToken: "a", expiresAt: now + 60_000 };

    expect(needsRefresh(tokens, now)).toBe(false);
    expect(needsRefresh(tokens, now + 29_999)).toBe(false);
    expect(needsRefresh(tokens, now + 30_000)).toBe(true);
  });

  it("reads stored tokens and ignores anything else", () => {
    const tokens = { accessToken: "a", refreshToken: "r", expiresAt: now };

    expect(parseStoredTokens(JSON.stringify(tokens))).toEqual(tokens);
    expect(parseStoredTokens(null)).toBeUndefined();
    expect(parseStoredTokens("not json")).toBeUndefined();
    expect(parseStoredTokens('{"accessToken":1}')).toBeUndefined();
  });
});

describe("sign-out", () => {
  it("returns to the screen through the provider's end-session page", () => {
    const url = new URL(
      endSessionUrl(
        {
          authorizationEndpoint: `${issuer}/auth`,
          tokenEndpoint: `${issuer}/token`,
          endSessionEndpoint: `${issuer}/logout`,
        },
        "draft-loop-web",
        "https://draftloop.example.test/",
      ) ?? "",
    );

    expect(`${url.origin}${url.pathname}`).toBe(`${issuer}/logout`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "draft-loop-web",
      post_logout_redirect_uri: "https://draftloop.example.test/",
    });
  });

  it("has no page to go to when the provider publishes none", () => {
    expect(
      endSessionUrl(
        { authorizationEndpoint: `${issuer}/auth`, tokenEndpoint: `${issuer}/token` },
        "draft-loop-web",
        "https://draftloop.example.test/",
      ),
    ).toBeUndefined();
  });
});
