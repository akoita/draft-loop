import { type ApiClient, ApiRequestError } from "./api-client.js";
import {
  authorizationUrl,
  codeChallenge,
  codeExchangeBody,
  createCodeVerifier,
  discoveryUrl,
  endSessionUrl,
  isExpectedState,
  needsRefresh,
  type ProviderEndpoints,
  parseDiscovery,
  parseStoredTokens,
  parseTokenResponse,
  randomValue,
  readAuthorizationResponse,
  refreshBody,
  type SignInTokens,
} from "./oidc-model.js";
import { createTokenStore } from "./session.js";

/** What the sign-in screen tells the person when a session ends or a sign-in fails. */
export const signInNotices = {
  expired: "Your sign-in has expired. Sign in again.",
  notMember:
    "This account is not a member of an organisation yet. Ask your organisation's owner for an invite.",
  refused: "The identity provider did not sign you in. Try again.",
  mismatch: "This sign-in was not started from this tab. Sign in again.",
  failed: "Sign-in could not be completed. Try again.",
  unreachable: "The identity provider cannot be reached. Try again later.",
} as const;

/** The session ended or a sign-in failed; `notice` says why, for the sign-in screen. */
export class SignInEndedError extends Error {
  readonly notice: string;

  constructor(notice: string, options?: ErrorOptions) {
    super(notice, options);
    this.name = "SignInEndedError";
    this.notice = notice;
  }
}

export interface OidcSessionOptions {
  readonly issuer: string;
  readonly clientId: string;
  /** The screen's own address, where the provider returns after signing in and out. */
  readonly redirectUri: string;
  readonly fetch: typeof fetch;
  readonly crypto: Pick<Crypto, "getRandomValues" | "subtle">;
  /** The tab's session storage; never local storage, so tokens end with the tab. */
  readonly storage: () => Storage | undefined;
  readonly now: () => number;
}

/** One tab's sign-in through the identity provider. */
export interface OidcSession {
  /** Whether tokens are stored, so the screen can open without signing in again. */
  isSignedIn(): boolean;
  /** Starts an attempt and returns the provider's sign-in page to go to. */
  begin(): Promise<string>;
  /**
   * Finishes the attempt the provider answered at the screen's address with `search`. Resolves
   * `false` when `search` is no answer; throws {@link SignInEndedError} when the answer is refused.
   */
  complete(search: string): Promise<boolean>;
  /** A current access token, refreshed when it is about to expire. */
  accessToken(): Promise<string>;
  /** Refreshes the access token once; on failure the session ends. */
  refresh(): Promise<string>;
  /**
   * Ends the session in this tab and returns the provider's sign-out page, if it has one. A notice
   * is kept for the sign-in screen the provider returns to.
   */
  signOut(notice?: string): Promise<string | undefined>;
  /** Forgets the tokens without leaving the screen. */
  clear(): void;
  /** The notice a previous page left for the sign-in screen, read once. */
  takeNotice(): string | undefined;
}

const tokensKey = "draft-loop.sign-in";
const attemptKey = "draft-loop.sign-in-attempt";
const noticeKey = "draft-loop.sign-in-notice";

interface Attempt {
  readonly state: string;
  readonly codeVerifier: string;
}

function parseAttempt(text: string | null): Attempt | undefined {
  if (text === null) return undefined;
  try {
    const value = JSON.parse(text) as Partial<Attempt>;
    return typeof value.state === "string" && typeof value.codeVerifier === "string"
      ? { state: value.state, codeVerifier: value.codeVerifier }
      : undefined;
  } catch {
    return undefined;
  }
}

export function createOidcSession(options: OidcSessionOptions): OidcSession {
  const tokenStore = createTokenStore(options.storage, tokensKey);
  const attemptStore = createTokenStore(options.storage, attemptKey);
  const noticeStore = createTokenStore(options.storage, noticeKey);
  let endpoints: Promise<ProviderEndpoints> | undefined;
  let refreshing: Promise<string> | undefined;
  let completing: { readonly search: string; readonly result: Promise<boolean> } | undefined;

  function providerEndpoints(): Promise<ProviderEndpoints> {
    if (endpoints === undefined) {
      const pending = (async () => {
        const response = await options.fetch(discoveryUrl(options.issuer), {
          headers: { accept: "application/json" },
        });
        if (!response.ok) throw new Error(`Discovery answered ${response.status}.`);
        return parseDiscovery(await response.json(), options.issuer);
      })();
      endpoints = pending;
      // A failed discovery is retried next time rather than remembered.
      pending.catch(() => {
        if (endpoints === pending) endpoints = undefined;
      });
    }
    return endpoints;
  }

  async function requestTokens(body: URLSearchParams, previousRefreshToken?: string) {
    const { tokenEndpoint } = await providerEndpoints();
    const response = await options.fetch(tokenEndpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
    if (!response.ok) throw new Error(`The token endpoint answered ${response.status}.`);
    const tokens = parseTokenResponse(await response.json(), options.now(), previousRefreshToken);
    tokenStore.write(JSON.stringify(tokens));
    return tokens;
  }

  const storedTokens = (): SignInTokens | undefined => parseStoredTokens(tokenStore.read());

  async function finish(search: string): Promise<boolean> {
    const answer = readAuthorizationResponse(search);
    if (answer === undefined) return false;
    const attempt = parseAttempt(attemptStore.read());
    // An attempt is answered once; a replayed address finds nothing to finish.
    attemptStore.clear();
    if (answer.kind === "error") throw new SignInEndedError(signInNotices.refused);
    if (attempt === undefined || !isExpectedState(attempt.state, answer.state))
      throw new SignInEndedError(signInNotices.mismatch);
    try {
      await requestTokens(
        codeExchangeBody({
          clientId: options.clientId,
          code: answer.code,
          redirectUri: options.redirectUri,
          codeVerifier: attempt.codeVerifier,
        }),
      );
    } catch (error) {
      throw new SignInEndedError(signInNotices.failed, { cause: error });
    }
    return true;
  }

  const session: OidcSession = {
    isSignedIn: () => storedTokens() !== undefined,

    async begin() {
      let found: ProviderEndpoints;
      try {
        found = await providerEndpoints();
      } catch (error) {
        throw new SignInEndedError(signInNotices.unreachable, { cause: error });
      }
      const state = randomValue(options.crypto);
      const codeVerifier = createCodeVerifier(options.crypto);
      const challenge = await codeChallenge(options.crypto.subtle, codeVerifier);
      attemptStore.write(JSON.stringify({ state, codeVerifier } satisfies Attempt));
      return authorizationUrl(found.authorizationEndpoint, {
        clientId: options.clientId,
        redirectUri: options.redirectUri,
        state,
        codeChallenge: challenge,
      });
    },

    complete(search) {
      // React may run the screen's start-up twice; the provider's code is exchanged only once.
      if (completing?.search !== search) completing = { search, result: finish(search) };
      return completing.result;
    },

    async accessToken() {
      const tokens = storedTokens();
      if (tokens === undefined) throw new SignInEndedError(signInNotices.expired);
      if (!needsRefresh(tokens, options.now())) return tokens.accessToken;
      if (tokens.refreshToken !== undefined) return session.refresh();
      if (options.now() < tokens.expiresAt) return tokens.accessToken;
      session.clear();
      throw new SignInEndedError(signInNotices.expired);
    },

    refresh() {
      if (refreshing === undefined) {
        const pending = (async () => {
          const refreshToken = storedTokens()?.refreshToken;
          try {
            if (refreshToken === undefined) throw new Error("No refresh token is stored.");
            const tokens = await requestTokens(
              refreshBody({ clientId: options.clientId, refreshToken }),
              refreshToken,
            );
            return tokens.accessToken;
          } catch (error) {
            session.clear();
            throw new SignInEndedError(signInNotices.expired, { cause: error });
          }
        })();
        refreshing = pending;
        void pending.then(
          () => (refreshing = undefined),
          () => (refreshing = undefined),
        );
      }
      return refreshing;
    },

    async signOut(notice) {
      session.clear();
      let found: ProviderEndpoints;
      try {
        found = await providerEndpoints();
      } catch {
        return undefined;
      }
      const url = endSessionUrl(found, options.clientId, options.redirectUri);
      if (url !== undefined && notice !== undefined) noticeStore.write(notice);
      return url;
    },

    clear() {
      tokenStore.clear();
      attemptStore.clear();
    },

    takeNotice() {
      const notice = noticeStore.read() ?? undefined;
      noticeStore.clear();
      return notice;
    },
  };
  return session;
}

/** How a signed-in client ends the session: `atProvider` also signs out at the provider. */
export type EndSession = (notice: string, atProvider: boolean) => void;

/**
 * A client that sends the current access token, refreshes it once when the API refuses it, and
 * ends the session when it cannot: an expired sign-in returns to the sign-in screen, and an account
 * with no organisation is signed out at the provider so another account can sign in.
 */
export function signedInClient(
  session: OidcSession,
  createClient: (token: string) => ApiClient,
  onEnd: EndSession,
): ApiClient {
  async function attempt<T>(call: (client: ApiClient) => Promise<T>): Promise<T> {
    let token: string;
    try {
      token = await session.accessToken();
    } catch (error) {
      if (error instanceof SignInEndedError) onEnd(error.notice, false);
      throw error;
    }
    try {
      return await call(createClient(token));
    } catch (error) {
      if (!(error instanceof ApiRequestError)) throw error;
      if (error.status === 403) {
        onEnd(signInNotices.notMember, true);
        throw error;
      }
      if (error.status !== 401) throw error;
    }
    // The API refused the token before running the route, so one retry with a fresh one is safe.
    let fresh: string;
    try {
      fresh = await session.refresh();
    } catch (error) {
      if (error instanceof SignInEndedError) onEnd(error.notice, false);
      throw error;
    }
    try {
      return await call(createClient(fresh));
    } catch (error) {
      if (error instanceof ApiRequestError && (error.status === 401 || error.status === 403)) {
        const notMember = error.status === 403;
        if (!notMember) session.clear();
        onEnd(notMember ? signInNotices.notMember : signInNotices.expired, notMember);
      }
      throw error;
    }
  }
  return {
    call: (operation, input) => attempt((client) => client.call(operation, input)),
  };
}
