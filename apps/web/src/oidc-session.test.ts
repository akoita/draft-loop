import { describe, expect, it } from "vitest";

import { type ApiClient, ApiRequestError } from "./api-client.js";
import {
  createOidcSession,
  type OidcSession,
  SignInEndedError,
  signedInClient,
  signInNotices,
} from "./oidc-session.js";

const issuer = "https://id.example.test/realms/draft-loop";
const screen = "https://draftloop.example.test/";
const start = Date.UTC(2026, 9, 24, 12);

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  };
}

interface TokenCall {
  readonly body: Record<string, string>;
  readonly headers: Record<string, string>;
}

/** A synthetic provider: its discovery document and a token endpoint that answers in turn. */
function provider(answers: Array<Response | (() => Response)>) {
  const tokenCalls: TokenCall[] = [];
  let discoveries = 0;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === `${issuer}/.well-known/openid-configuration`) {
      discoveries += 1;
      return Response.json({
        issuer,
        authorization_endpoint: `${issuer}/protocol/openid-connect/auth`,
        token_endpoint: `${issuer}/protocol/openid-connect/token`,
        end_session_endpoint: `${issuer}/protocol/openid-connect/logout`,
      });
    }
    if (url === `${issuer}/protocol/openid-connect/token`) {
      tokenCalls.push({
        body: Object.fromEntries(new URLSearchParams(String(init?.body))),
        headers: init?.headers as Record<string, string>,
      });
      const answer = answers.shift();
      if (answer === undefined) throw new Error("No token answer is left.");
      return typeof answer === "function" ? answer() : answer;
    }
    throw new Error(`Unexpected fetch of ${url}.`);
  };
  return {
    fetch,
    tokenCalls,
    discoveries: () => discoveries,
  };
}

function setup(answers: Array<Response | (() => Response)> = []) {
  const storage = memoryStorage();
  const stub = provider(answers);
  const clock = { now: start };
  const make = () =>
    createOidcSession({
      issuer,
      clientId: "draft-loop-web",
      redirectUri: screen,
      fetch: stub.fetch,
      crypto: globalThis.crypto,
      storage: () => storage,
      now: () => clock.now,
    });
  return { storage, stub, clock, session: make(), make };
}

const tokens = (access: string, refresh?: string, expiresIn = 300) =>
  Response.json({
    access_token: access,
    token_type: "Bearer",
    expires_in: expiresIn,
    ...(refresh === undefined ? {} : { refresh_token: refresh }),
  });

async function signIn(context: ReturnType<typeof setup>): Promise<OidcSession> {
  const url = new URL(await context.session.begin());
  // The provider returns to the screen, a new page with a new session object.
  const returned = context.make();
  await returned.complete(`?code=code-1&state=${url.searchParams.get("state")}`);
  return returned;
}

describe("sign-in through the identity provider", () => {
  it("sends the person to the provider with a fresh state and an S256 challenge", async () => {
    const context = setup();

    const url = new URL(await context.session.begin());

    expect(url.searchParams.get("redirect_uri")).toBe(screen);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(url.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(context.storage.getItem("draft-loop.sign-in")).toBeNull();
  });

  it("exchanges the returned code with the verifier and keeps the tokens in session storage", async () => {
    const context = setup([tokens("access-1", "refresh-1")]);

    const session = await signIn(context);

    const [call] = context.stub.tokenCalls;
    expect(call?.headers["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(call?.body).toMatchObject({
      grant_type: "authorization_code",
      client_id: "draft-loop-web",
      code: "code-1",
      redirect_uri: screen,
    });
    expect(call?.body.code_verifier).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(session.isSignedIn()).toBe(true);
    expect(await session.accessToken()).toBe("access-1");
    expect(JSON.parse(context.storage.getItem("draft-loop.sign-in") ?? "")).toEqual({
      accessToken: "access-1",
      refreshToken: "refresh-1",
      expiresAt: start + 300_000,
    });
  });

  it("exchanges a code once when the screen starts twice", async () => {
    const context = setup([tokens("access-1", "refresh-1")]);
    const state = new URL(await context.session.begin()).searchParams.get("state");
    const returned = context.make();

    const search = `?code=code-1&state=${state}`;
    await Promise.all([returned.complete(search), returned.complete(search)]);

    expect(context.stub.tokenCalls).toHaveLength(1);
  });

  it("refuses an answer whose state this tab did not send", async () => {
    const context = setup([tokens("access-1")]);
    await context.session.begin();

    await expect(context.make().complete("?code=code-1&state=forged")).rejects.toEqual(
      new SignInEndedError(signInNotices.mismatch),
    );
    expect(context.stub.tokenCalls).toHaveLength(0);
  });

  it("says when the provider did not sign the person in", async () => {
    const context = setup();
    await context.session.begin();

    await expect(context.make().complete("?error=access_denied&state=x")).rejects.toMatchObject({
      notice: signInNotices.refused,
    });
  });

  it("reports an unreachable provider when sign-in starts", async () => {
    const session = createOidcSession({
      issuer,
      clientId: "draft-loop-web",
      redirectUri: screen,
      fetch: async () => {
        throw new TypeError("offline");
      },
      crypto: globalThis.crypto,
      storage: () => undefined,
      now: () => start,
    });

    await expect(session.begin()).rejects.toMatchObject({ notice: signInNotices.unreachable });
  });
});

describe("refresh", () => {
  it("refreshes the access token before it expires", async () => {
    const context = setup([tokens("access-1", "refresh-1"), tokens("access-2")]);
    const session = await signIn(context);

    context.clock.now = start + 280_000;

    expect(await session.accessToken()).toBe("access-2");
    expect(context.stub.tokenCalls[1]?.body).toEqual({
      grant_type: "refresh_token",
      client_id: "draft-loop-web",
      refresh_token: "refresh-1",
    });
    expect(JSON.parse(context.storage.getItem("draft-loop.sign-in") ?? "")).toMatchObject({
      accessToken: "access-2",
      refreshToken: "refresh-1",
    });
  });

  it("ends the session when the refresh is refused", async () => {
    const context = setup([tokens("access-1", "refresh-1"), new Response("{}", { status: 400 })]);
    const session = await signIn(context);

    await expect(session.refresh()).rejects.toMatchObject({ notice: signInNotices.expired });
    expect(session.isSignedIn()).toBe(false);
  });
});

describe("signed-in client", () => {
  function api(answers: Array<"ok" | 401 | 403>) {
    const seen: string[] = [];
    const createClient = (token: string): ApiClient => ({
      call: async () => {
        seen.push(token);
        const answer = answers.shift();
        if (answer === "ok") return { status: "ok" } as never;
        throw new ApiRequestError(answer ?? 500, "refused", "Refused.");
      },
    });
    return { seen, createClient };
  }

  it("refreshes once and retries when the API refuses the access token", async () => {
    const context = setup([tokens("access-1", "refresh-1"), tokens("access-2")]);
    const session = await signIn(context);
    const ended: unknown[] = [];
    const stub = api([401, "ok"]);

    const client = signedInClient(session, stub.createClient, (...args) => ended.push(args));

    expect(await client.call("GET /v1/health", {})).toEqual({ status: "ok" });
    expect(stub.seen).toEqual(["access-1", "access-2"]);
    expect(ended).toEqual([]);
  });

  it("returns to sign-in when the refreshed token is refused too", async () => {
    const context = setup([tokens("access-1", "refresh-1"), tokens("access-2")]);
    const session = await signIn(context);
    const ended: unknown[] = [];
    const client = signedInClient(session, api([401, 401]).createClient, (...args) =>
      ended.push(args),
    );

    await expect(client.call("GET /v1/health", {})).rejects.toMatchObject({ status: 401 });
    expect(ended).toEqual([[signInNotices.expired, false]]);
    expect(session.isSignedIn()).toBe(false);
  });

  it("returns to sign-in when the refresh fails", async () => {
    const context = setup([tokens("access-1", "refresh-1"), new Response("{}", { status: 400 })]);
    const session = await signIn(context);
    const ended: unknown[] = [];
    const client = signedInClient(session, api([401]).createClient, (...args) => ended.push(args));

    await expect(client.call("GET /v1/health", {})).rejects.toBeInstanceOf(SignInEndedError);
    expect(ended).toEqual([[signInNotices.expired, false]]);
  });

  it("signs a person who is not a member out at the provider", async () => {
    const context = setup([tokens("access-1", "refresh-1")]);
    const session = await signIn(context);
    const ended: unknown[] = [];
    const client = signedInClient(session, api([403]).createClient, (...args) => ended.push(args));

    await expect(client.call("GET /v1/health", {})).rejects.toMatchObject({ status: 403 });
    expect(ended).toEqual([[signInNotices.notMember, true]]);
  });
});

describe("sign-out", () => {
  it("forgets the tokens and returns to the screen through the provider", async () => {
    const context = setup([tokens("access-1", "refresh-1")]);
    const session = await signIn(context);

    const url = new URL((await session.signOut(signInNotices.notMember)) ?? "");

    expect(`${url.origin}${url.pathname}`).toBe(`${issuer}/protocol/openid-connect/logout`);
    expect(url.searchParams.get("post_logout_redirect_uri")).toBe(screen);
    expect(session.isSignedIn()).toBe(false);
    // The screen the provider returns to shows why, once.
    const next = context.make();
    expect(next.takeNotice()).toBe(signInNotices.notMember);
    expect(next.takeNotice()).toBeUndefined();
  });

  it("only forgets the tokens when the provider cannot be reached", async () => {
    const session = createOidcSession({
      issuer,
      clientId: "draft-loop-web",
      redirectUri: screen,
      fetch: async () => new Response("", { status: 503 }),
      crypto: globalThis.crypto,
      storage: () => undefined,
      now: () => start,
    });

    expect(await session.signOut()).toBeUndefined();
    expect(session.isSignedIn()).toBe(false);
  });
});
