import { describe, expect, it } from "vitest";

import { type CheckFetch, checkServer } from "./server-check.js";

function fakeFetch(routes: Record<string, { status: number; body?: unknown } | Error>): CheckFetch {
  return async (url) => {
    const route = routes[url];
    if (route === undefined) return { ok: false, status: 404, json: async () => ({}) };
    if (route instanceof Error) throw route;
    return { ok: route.status < 300, status: route.status, json: async () => route.body };
  };
}

const origin = "https://draftloop.example";

describe("checkServer", () => {
  it("reads owner-token mode", async () => {
    const fetch = fakeFetch({
      [`${origin}/v1/health`]: { status: 200, body: {} },
      [`${origin}/v1/auth/config`]: { status: 200, body: { mode: "owner" } },
    });
    expect(await checkServer(origin, fetch)).toEqual({ reachable: true, signIn: "owner" });
  });

  it("reads sign-in mode and keeps only the issuer's origin", async () => {
    const fetch = fakeFetch({
      [`${origin}/v1/health`]: { status: 200 },
      [`${origin}/v1/auth/config`]: {
        status: 200,
        body: { mode: "oidc", issuer: "https://id.example/realms/draftloop", clientId: "web" },
      },
    });
    expect(await checkServer(origin, fetch)).toEqual({
      reachable: true,
      signIn: "oidc",
      issuerOrigin: "https://id.example",
    });
  });

  it("says why a server cannot be opened", async () => {
    expect(
      await checkServer(origin, fakeFetch({ [`${origin}/v1/health`]: new Error("refused") })),
    ).toEqual({
      reachable: false,
      reason: "The server cannot be reached.",
    });
    expect(
      await checkServer(origin, fakeFetch({ [`${origin}/v1/health`]: { status: 503 } })),
    ).toEqual({
      reachable: false,
      reason: "The server answered 503.",
    });
    expect(
      await checkServer(origin, fakeFetch({ [`${origin}/v1/health`]: { status: 200 } })),
    ).toMatchObject({
      reachable: false,
      reason: "This does not look like a DraftLoop server.",
    });
    const odd = fakeFetch({
      [`${origin}/v1/health`]: { status: 200 },
      [`${origin}/v1/auth/config`]: { status: 200, body: { mode: "oidc", issuer: "javascript:x" } },
    });
    expect(await checkServer(origin, odd)).toMatchObject({ reachable: false });
  });

  it("gives up after its timeout", async () => {
    const hanging: CheckFetch = (_url, init) =>
      new Promise((_resolve, reject) =>
        init.signal.addEventListener("abort", () => reject(new Error("aborted"))),
      );
    expect(await checkServer(origin, hanging, 10)).toEqual({
      reachable: false,
      reason: "The server did not answer in time.",
    });
  });
});
