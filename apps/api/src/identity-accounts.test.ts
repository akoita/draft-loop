import { describe, expect, it } from "vitest";

import {
  IdentityAccountsError,
  identityAdminClientFromEnv,
  keycloakAccounts,
  keycloakRealmOf,
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
