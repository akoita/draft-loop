/**
 * Sign-in through the identity provider (ADR 0011, D6): OAuth 2 authorization code with PKCE (S256)
 * as a public client. These functions build and check what goes to and comes back from the
 * provider; `oidc-session.ts` keeps the state between them.
 */

/** The parts of the provider's OpenID Connect discovery document the screen uses. */
export interface ProviderEndpoints {
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  /** Where to end the provider's session; some providers publish none. */
  readonly endSessionEndpoint?: string;
}

/** The tokens of one sign-in, kept in the tab's session storage. */
export interface SignInTokens {
  readonly accessToken: string;
  readonly refreshToken?: string;
  /** When the access token expires, in milliseconds since the epoch. */
  readonly expiresAt: number;
}

/** What the screen asks the provider for: who signed in, nothing more. */
export const signInScope = "openid email profile";

/** How long before its expiry an access token is refreshed, in milliseconds. */
export const refreshMarginMs = 30_000;

/** Encodes bytes as unpadded base64url, as PKCE and the state value use. */
export function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

/** A random value of `byteCount` bytes, base64url-encoded. */
export function randomValue(crypto: Pick<Crypto, "getRandomValues">, byteCount = 32): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(byteCount)));
}

/** PKCE's code verifier: 43 characters from the unreserved set (RFC 7636, section 4.1). */
export function createCodeVerifier(crypto: Pick<Crypto, "getRandomValues">): string {
  return randomValue(crypto, 32);
}

/** PKCE's S256 code challenge: the verifier's SHA-256, base64url-encoded. */
export async function codeChallenge(
  subtle: Pick<SubtleCrypto, "digest">,
  verifier: string,
): Promise<string> {
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

/** The discovery document's address for an issuer. */
export function discoveryUrl(issuer: string): string {
  return `${issuer.replace(/\/+$/u, "")}/.well-known/openid-configuration`;
}

/** Whether an endpoint is one the screen may use for this issuer: https, or http like the issuer. */
function isEndpoint(value: unknown, issuer: string): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    const issuerProtocol = new URL(issuer).protocol;
    return url.protocol === "https:" || url.protocol === issuerProtocol;
  } catch {
    return false;
  }
}

/** Reads the endpoints from a discovery document, refusing one that names another issuer. */
export function parseDiscovery(document: unknown, issuer: string): ProviderEndpoints {
  const fields = (document ?? {}) as Record<string, unknown>;
  if (fields.issuer !== issuer) throw new Error("The identity provider names another issuer.");
  const { authorization_endpoint: authorize, token_endpoint: token } = fields;
  if (!isEndpoint(authorize, issuer) || !isEndpoint(token, issuer))
    throw new Error("The identity provider publishes no usable sign-in endpoints.");
  const endSession = fields.end_session_endpoint;
  return {
    authorizationEndpoint: authorize,
    tokenEndpoint: token,
    ...(isEndpoint(endSession, issuer) ? { endSessionEndpoint: endSession } : {}),
  };
}

export interface AuthorizationRequest {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly state: string;
  readonly codeChallenge: string;
}

/** The provider's sign-in page for one attempt. */
export function authorizationUrl(endpoint: string, request: AuthorizationRequest): string {
  const url = new URL(endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", request.clientId);
  url.searchParams.set("redirect_uri", request.redirectUri);
  url.searchParams.set("scope", signInScope);
  url.searchParams.set("state", request.state);
  url.searchParams.set("code_challenge", request.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

/** What the provider sent back to the screen's address, or `undefined` when it is no answer. */
export type AuthorizationResponse =
  | { readonly kind: "code"; readonly code: string; readonly state: string }
  | { readonly kind: "error"; readonly error: string; readonly state?: string };

export function readAuthorizationResponse(search: string): AuthorizationResponse | undefined {
  const params = new URLSearchParams(search);
  const error = params.get("error");
  const state = params.get("state");
  if (error !== null) return { kind: "error", error, ...(state === null ? {} : { state }) };
  const code = params.get("code");
  if (code === null || state === null) return undefined;
  return { kind: "code", code, state };
}

/** Compares the returned state with the one this tab sent; another value is a forged answer. */
export function isExpectedState(expected: string | undefined, returned: string): boolean {
  return expected !== undefined && expected.length > 0 && expected === returned;
}

/** The token request exchanging an authorization code, form-encoded. */
export function codeExchangeBody(input: {
  readonly clientId: string;
  readonly code: string;
  readonly redirectUri: string;
  readonly codeVerifier: string;
}): URLSearchParams {
  return new URLSearchParams({
    grant_type: "authorization_code",
    client_id: input.clientId,
    code: input.code,
    redirect_uri: input.redirectUri,
    code_verifier: input.codeVerifier,
  });
}

/** The token request using a refresh token, form-encoded. */
export function refreshBody(input: {
  readonly clientId: string;
  readonly refreshToken: string;
}): URLSearchParams {
  return new URLSearchParams({
    grant_type: "refresh_token",
    client_id: input.clientId,
    refresh_token: input.refreshToken,
  });
}

/**
 * Reads a token endpoint's answer. A refresh answer may leave out the refresh token, in which case
 * the previous one stays in use.
 */
export function parseTokenResponse(
  body: unknown,
  now: number,
  previousRefreshToken?: string,
): SignInTokens {
  const fields = (body ?? {}) as Record<string, unknown>;
  const {
    access_token: accessToken,
    token_type: tokenType,
    expires_in: expiresIn,
    refresh_token: refreshToken,
  } = fields;
  if (typeof accessToken !== "string" || accessToken === "")
    throw new Error("The identity provider sent no access token.");
  if (typeof tokenType === "string" && tokenType.toLowerCase() !== "bearer")
    throw new Error("The identity provider sent a token the API does not take.");
  if (typeof expiresIn !== "number" || !Number.isFinite(expiresIn) || expiresIn <= 0)
    throw new Error("The identity provider did not say when the token expires.");
  const kept =
    typeof refreshToken === "string" && refreshToken !== "" ? refreshToken : previousRefreshToken;
  return {
    accessToken,
    ...(kept === undefined ? {} : { refreshToken: kept }),
    expiresAt: now + expiresIn * 1000,
  };
}

/** Whether the access token should be refreshed before the next call. */
export function needsRefresh(tokens: SignInTokens, now: number): boolean {
  return now >= tokens.expiresAt - refreshMarginMs;
}

/** Reads stored tokens, or `undefined` when nothing usable is stored. */
export function parseStoredTokens(text: string | null): SignInTokens | undefined {
  if (text === null) return undefined;
  try {
    const value = JSON.parse(text) as Partial<SignInTokens>;
    if (typeof value.accessToken !== "string" || typeof value.expiresAt !== "number")
      return undefined;
    return {
      accessToken: value.accessToken,
      ...(typeof value.refreshToken === "string" ? { refreshToken: value.refreshToken } : {}),
      expiresAt: value.expiresAt,
    };
  } catch {
    return undefined;
  }
}

/** The provider's sign-out page, which returns to the screen, or `undefined` when it has none. */
export function endSessionUrl(
  endpoints: ProviderEndpoints,
  clientId: string,
  postLogoutRedirectUri: string,
): string | undefined {
  if (endpoints.endSessionEndpoint === undefined) return undefined;
  const url = new URL(endpoints.endSessionEndpoint);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("post_logout_redirect_uri", postLogoutRedirectUri);
  return url.toString();
}
