import { describe, expect, it } from "vitest";

import { buildApi } from "./app.js";
import type { ApiAuthOptions } from "./request-auth.js";

const ownerToken = "owner-token-for-tests-0123456789abcdef";

const oidc: ApiAuthOptions = {
  mode: "oidc",
  issuer: "https://id.example.test/realms/draft-loop",
  audience: "draft-loop-api",
  webClientId: "draft-loop-web",
  allowHttp: false,
  resolveSignIn: async () => undefined,
  keys: async () => {
    throw new Error("no token is verified here");
  },
};

async function answer(auth?: ApiAuthOptions) {
  const app = await buildApi({ ownerToken, ...(auth === undefined ? {} : { auth }) });
  try {
    return await app.inject({ method: "GET", url: "/v1/auth/config" });
  } finally {
    await app.close();
  }
}

describe("sign-in configuration", () => {
  it("tells the screen to ask for the owner token in owner mode, without a credential", async () => {
    const response = await answer();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ mode: "owner" });
  });

  it("names the issuer and the screen's client in sign-in mode, without a credential", async () => {
    const response = await answer(oidc);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      mode: "oidc",
      issuer: "https://id.example.test/realms/draft-loop",
      clientId: "draft-loop-web",
    });
  });

  it("allows the browser to reach the identity provider only in sign-in mode", async () => {
    const owner = String((await answer()).headers["content-security-policy"]);
    const signIn = String((await answer(oidc)).headers["content-security-policy"]);

    expect(owner).toContain("connect-src 'self';");
    expect(signIn).toContain("connect-src 'self' https://id.example.test;");
    expect(signIn.replace(" https://id.example.test", "")).toBe(owner);
  });
});
