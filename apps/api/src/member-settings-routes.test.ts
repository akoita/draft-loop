import type {
  MemberScreenLanguage,
  MemberSettingsStore,
} from "@draft-loop/storage/member-settings";
import { TenantDirectoryError } from "@draft-loop/storage/tenant-directory";
import type { FastifyInstance } from "fastify";
import { createLocalJWKSet, exportJWK, generateKeyPair, type JWTVerifyGetKey, SignJWT } from "jose";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { buildApi } from "./app.js";

const ownerToken = "owner-token-for-tests-0123456789abcdef";
const issuer = "https://id.example.test/realms/draft-loop";
const audience = "draft-loop-api";
const members = ["member-north", "member-other"];

/** Saved languages by organisation and member; only the listed members exist. */
function memorySettings(): MemberSettingsStore & { saved: Map<string, MemberScreenLanguage> } {
  const saved = new Map<string, MemberScreenLanguage>();
  return {
    saved,
    readScreenLanguage: async ({ organisationId, memberId }) =>
      saved.get(`${organisationId}/${memberId}`),
    saveScreenLanguage: async ({ organisationId, memberId, language }) => {
      if (!members.includes(memberId)) {
        throw new TenantDirectoryError("member_not_found", "No such member.");
      }
      saved.set(`${organisationId}/${memberId}`, language);
    },
  };
}

let signingKey: Awaited<ReturnType<typeof generateKeyPair>>;
let keys: JWTVerifyGetKey;
let app: FastifyInstance | undefined;

beforeAll(async () => {
  signingKey = await generateKeyPair("ES256");
  keys = createLocalJWKSet({
    keys: [{ ...(await exportJWK(signingKey.publicKey)), kid: "key-1", alg: "ES256" }],
  });
});

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function signIn(memberId: string): Promise<string> {
  const token = await new SignJWT({ email_verified: true })
    .setProtectedHeader({ alg: "ES256", kid: "key-1" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject(memberId)
    .setExpirationTime("5m")
    .sign(signingKey.privateKey);
  return `Bearer ${token}`;
}

async function api(settings: MemberSettingsStore, mode: "owner" | "oidc" = "oidc") {
  app = await buildApi({
    ownerToken,
    memberSettings: settings,
    auth:
      mode === "owner"
        ? { mode: "owner" }
        : {
            mode: "oidc",
            issuer,
            audience,
            webClientId: "draft-loop-web",
            allowHttp: false,
            keys,
            resolveSignIn: async ({ subject }) => ({
              tenantId: "org-north",
              memberId: subject,
              role: "member" as const,
            }),
          },
  });
  return app;
}

describe("/v1/me/screen-language", () => {
  it("answers null until the member saves a language, then the saved one", async () => {
    const settings = memorySettings();
    const server = await api(settings);
    const authorization = await signIn("member-north");

    const before = await server.inject({
      method: "GET",
      url: "/v1/me/screen-language",
      headers: { authorization },
    });
    expect(before.statusCode).toBe(200);
    expect(before.json()).toEqual({ language: null });

    const saved = await server.inject({
      method: "PUT",
      url: "/v1/me/screen-language",
      headers: { authorization },
      payload: { language: "fr" },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toEqual({ language: "fr" });
    expect(settings.saved.get("org-north/member-north")).toBe("fr");

    const after = await server.inject({
      method: "GET",
      url: "/v1/me/screen-language",
      headers: { authorization },
    });
    expect(after.json()).toEqual({ language: "fr" });
  });

  it("refuses a language the screens do not offer, and a member the directory lost", async () => {
    const server = await api(memorySettings());
    const unsupported = await server.inject({
      method: "PUT",
      url: "/v1/me/screen-language",
      headers: { authorization: await signIn("member-north") },
      payload: { language: "de" },
    });
    expect(unsupported.statusCode).toBe(400);

    const gone = await server.inject({
      method: "PUT",
      url: "/v1/me/screen-language",
      headers: { authorization: await signIn("member-gone") },
      payload: { language: "fr" },
    });
    expect(gone.statusCode).toBe(404);
  });

  it("answers 404 to the owner token, whose screen keeps the browser's choice", async () => {
    const server = await api(memorySettings(), "owner");
    const response = await server.inject({
      method: "GET",
      url: "/v1/me/screen-language",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: "not_found" } });
  });
});
