import { describe, expect, it } from "vitest";

import {
  IdentityAccountsError,
  identityAdminClientFromEnv,
  keycloakAccounts,
  keycloakRealmOf,
  passwordLinkLifespanSeconds,
} from "./identity-accounts.js";

const issuer = "https://id.example.test/realms/draft-loop";
const subject = "6b1f3c2e-0d4a-4b8e-9a51-2f7c1d9e8a40";

interface Call {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body?: string;
}

function fakeFetch(answers: readonly Response[]) {
  const calls: Call[] = [];
  const queue = [...answers];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      ...(init?.body === undefined ? {} : { body: String(init.body) }),
    });
    const next = queue.shift();
    if (next === undefined) throw new Error("unexpected call");
    return next;
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const tokenAnswer = () => Response.json({ access_token: "admin-token", expires_in: 60 });

describe("Keycloak accounts", () => {
  it("names the admin base and realm of an issuer", () => {
    expect(keycloakRealmOf(issuer)).toEqual({
      base: "https://id.example.test",
      realm: "draft-loop",
    });
    expect(keycloakRealmOf("https://id.example.test/")).toBeUndefined();
  });

  it("signs in as its client, then deletes the realm's user", async () => {
    const { fetch, calls } = fakeFetch([tokenAnswer(), new Response(null, { status: 204 })]);
    const accounts = keycloakAccounts({
      issuer,
      clientId: "draft-loop-api",
      clientSecret: "s3cret",
      fetch,
    });

    await accounts.deleteAccount(subject);

    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      url: `${issuer}/protocol/openid-connect/token`,
      method: "POST",
    });
    expect(new URLSearchParams(calls[0]?.body)).toEqual(
      new URLSearchParams({
        grant_type: "client_credentials",
        client_id: "draft-loop-api",
        client_secret: "s3cret",
      }),
    );
    expect(calls[1]).toMatchObject({
      url: `https://id.example.test/admin/realms/draft-loop/users/${subject}`,
      method: "DELETE",
      headers: { authorization: "Bearer admin-token" },
    });
  });

  it("reaches Keycloak at its own address when one is given", async () => {
    const { fetch, calls } = fakeFetch([tokenAnswer(), new Response(null, { status: 204 })]);
    await keycloakAccounts({
      issuer,
      clientId: "c",
      clientSecret: "s",
      baseUrl: "https://keycloak.internal.example.test/",
      fetch,
    }).deleteAccount(subject);
    expect(calls.map((call) => call.url)).toEqual([
      "https://keycloak.internal.example.test/realms/draft-loop/protocol/openid-connect/token",
      `https://keycloak.internal.example.test/admin/realms/draft-loop/users/${subject}`,
    ]);
  });

  it("counts an account already gone as deleted, and fails on anything else", async () => {
    const gone = fakeFetch([tokenAnswer(), new Response(null, { status: 404 })]);
    await keycloakAccounts({
      issuer,
      clientId: "c",
      clientSecret: "s",
      fetch: gone.fetch,
    }).deleteAccount(subject);

    const refused = fakeFetch([tokenAnswer(), new Response(null, { status: 403 })]);
    await expect(
      keycloakAccounts({
        issuer,
        clientId: "c",
        clientSecret: "s",
        fetch: refused.fetch,
      }).deleteAccount(subject),
    ).rejects.toBeInstanceOf(IdentityAccountsError);

    const noClient = fakeFetch([new Response(null, { status: 401 })]);
    await expect(
      keycloakAccounts({
        issuer,
        clientId: "c",
        clientSecret: "s",
        fetch: noClient.fetch,
      }).deleteAccount(subject),
    ).rejects.toThrow("refused the client (401)");
  });

  it("never sends a subject that is not a user id into the admin path", async () => {
    const { fetch, calls } = fakeFetch([]);
    const accounts = keycloakAccounts({ issuer, clientId: "c", clientSecret: "s", fetch });
    await expect(accounts.deleteAccount("../../clients/x")).rejects.toBeInstanceOf(
      IdentityAccountsError,
    );
    expect(calls).toEqual([]);
  });

  it("reads the client from both variables or neither", () => {
    expect(identityAdminClientFromEnv({})).toBeUndefined();
    expect(
      identityAdminClientFromEnv({
        DRAFT_LOOP_IDENTITY_ADMIN_CLIENT_ID: "draft-loop-api",
        DRAFT_LOOP_IDENTITY_ADMIN_CLIENT_SECRET: "s3cret",
      }),
    ).toEqual({ clientId: "draft-loop-api", clientSecret: "s3cret" });
    expect(
      identityAdminClientFromEnv({
        DRAFT_LOOP_IDENTITY_ADMIN_CLIENT_ID: "draft-loop-api",
        DRAFT_LOOP_IDENTITY_ADMIN_CLIENT_SECRET: "s3cret",
        DRAFT_LOOP_IDENTITY_ADMIN_URL: "https://keycloak.internal.example.test",
      }),
    ).toEqual({
      clientId: "draft-loop-api",
      clientSecret: "s3cret",
      baseUrl: "https://keycloak.internal.example.test",
    });
    expect(() =>
      identityAdminClientFromEnv({
        DRAFT_LOOP_IDENTITY_ADMIN_CLIENT_ID: "draft-loop-api",
        DRAFT_LOOP_IDENTITY_ADMIN_CLIENT_SECRET: "s3cret",
        DRAFT_LOOP_IDENTITY_ADMIN_URL: "https://keycloak.example.test/realms/x",
      }),
    ).toThrow(IdentityAccountsError);
    expect(() =>
      identityAdminClientFromEnv({ DRAFT_LOOP_IDENTITY_ADMIN_CLIENT_ID: "draft-loop-api" }),
    ).toThrow(IdentityAccountsError);
  });
});

describe("an invited person's sign-in (#3082)", () => {
  const screenUrl = "https://draftloop.example.test/";
  const make = (answers: readonly Response[]) => {
    const fake = fakeFetch(answers);
    const accounts = keycloakAccounts({
      issuer,
      clientId: "draft-loop-api",
      clientSecret: "s3cret",
      webClientId: "draft-loop-web",
      screenUrl,
      fetch: fake.fetch,
    });
    return { ...fake, accounts };
  };
  const found = (email = "ada@example.test") => Response.json([{ id: subject, email }]);
  const admin = "https://id.example.test/admin/realms/draft-loop";

  it("creates a verified account and has Keycloak email a choose-a-password link", async () => {
    const { accounts, calls } = make([
      tokenAnswer(),
      new Response(null, { status: 201 }),
      found(),
      new Response(null, { status: 204 }),
    ]);

    await expect(
      accounts.prepareInvitedAccount({ email: " Ada@Example.Test ", locale: "fr" }),
    ).resolves.toBe("password-email");

    expect(calls[1]).toMatchObject({ url: `${admin}/users`, method: "POST" });
    expect(JSON.parse(calls[1]?.body ?? "")).toEqual({
      username: "ada@example.test",
      email: "ada@example.test",
      enabled: true,
      emailVerified: true,
      attributes: { locale: ["fr"] },
    });
    expect(calls[2]?.url).toBe(
      `${admin}/users?exact=true&briefRepresentation=true&email=ada%40example.test`,
    );
    const sent = new URL(calls[3]?.url ?? "");
    expect(sent.pathname).toBe(`/admin/realms/draft-loop/users/${subject}/execute-actions-email`);
    expect(Object.fromEntries(sent.searchParams)).toEqual({
      client_id: "draft-loop-web",
      redirect_uri: `${screenUrl}#welcome`,
      lifespan: String(passwordLinkLifespanSeconds),
    });
    expect(calls[3]).toMatchObject({ method: "PUT", body: '["UPDATE_PASSWORD"]' });
  });

  it("sends nothing to an existing account that has a password", async () => {
    const { accounts, calls } = make([
      tokenAnswer(),
      new Response(null, { status: 409 }),
      found(),
      Response.json([
        { id: "c1", type: "otp" },
        { id: "c2", type: "password" },
      ]),
    ]);

    await expect(accounts.prepareInvitedAccount({ email: "ada@example.test" })).resolves.toBe(
      "exists",
    );
    expect(calls).toHaveLength(4);
    expect(calls[3]?.url).toBe(`${admin}/users/${subject}/credentials`);
  });

  it("sends the link again to an existing account with no password yet", async () => {
    const { accounts, calls } = make([
      tokenAnswer(),
      new Response(null, { status: 409 }),
      found(),
      Response.json([]),
      new Response(null, { status: 204 }),
    ]);

    await expect(accounts.prepareInvitedAccount({ email: "ada@example.test" })).resolves.toBe(
      "password-email",
    );
    expect(calls[4]?.method).toBe("PUT");
  });

  it("matches the account by its exact email, not a similar one", async () => {
    const { accounts } = make([
      tokenAnswer(),
      new Response(null, { status: 409 }),
      Response.json([{ id: subject, email: "ada@example.test.other" }]),
    ]);

    await expect(accounts.prepareInvitedAccount({ email: "ada@example.test" })).rejects.toThrow(
      IdentityAccountsError,
    );
  });

  it("fails when Keycloak refuses to create the account or to send the email", async () => {
    await expect(
      make([tokenAnswer(), new Response(null, { status: 403 })]).accounts.prepareInvitedAccount({
        email: "ada@example.test",
      }),
    ).rejects.toThrow("did not create the account (403)");
    await expect(
      make([
        tokenAnswer(),
        new Response(null, { status: 201 }),
        found(),
        new Response(null, { status: 500 }),
      ]).accounts.prepareInvitedAccount({ email: "ada@example.test" }),
    ).rejects.toThrow("did not send the password email (500)");
  });

  it("refuses an address that is not an email, and a client without the web screen", async () => {
    await expect(make([]).accounts.prepareInvitedAccount({ email: "nobody" })).rejects.toThrow(
      IdentityAccountsError,
    );
    const bare = keycloakAccounts({
      issuer,
      clientId: "draft-loop-api",
      clientSecret: "s3cret",
      fetch: fakeFetch([]).fetch,
    });
    await expect(bare.prepareInvitedAccount({ email: "ada@example.test" })).rejects.toThrow(
      "web screen",
    );
  });
});
