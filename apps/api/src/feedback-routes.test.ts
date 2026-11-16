import type { FeedbackNote, FeedbackStore, SendFeedbackInput } from "@draft-loop/storage/feedback";
import { TenantDirectoryError } from "@draft-loop/storage/tenant-directory";
import type { FastifyInstance } from "fastify";
import { createLocalJWKSet, exportJWK, generateKeyPair, type JWTVerifyGetKey, SignJWT } from "jose";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { buildApi } from "./app.js";

const ownerToken = "owner-token-for-tests-0123456789abcdef";
const issuer = "https://id.example.test/realms/draft-loop";
const audience = "draft-loop-api";

/** Notes kept in memory, trimmed and bounded as the Postgres store does. */
function memoryFeedback() {
  const notes: FeedbackNote[] = [];
  const store: FeedbackStore = {
    send: async (input: SendFeedbackInput) => {
      const text = input.text.trim();
      if (text === "" || text.length > 2_000) {
        throw new TenantDirectoryError("invalid_input", "A note has 1 to 2000 characters.");
      }
      const note: FeedbackNote = {
        noteId: `note-${notes.length + 1}`,
        organisationId: input.organisationId,
        memberId: input.memberId,
        category: input.category,
        screen: input.screen,
        text,
        sentAt: input.now.toISOString(),
      };
      notes.push(note);
      return note;
    },
    listNewest: async (limit) => [...notes].reverse().slice(0, limit),
  };
  return { store, notes };
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

async function api(feedback: FeedbackStore, mode: "owner" | "oidc" = "oidc") {
  app = await buildApi({
    ownerToken,
    feedback,
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
              tenantId: subject === "member-south" ? "org-south" : "org-north",
              memberId: subject,
              role: "member" as const,
            }),
          },
  });
  return app;
}

describe("feedback notes (#2828)", () => {
  it("stores a member's note in their own organisation and lists it to the operator", async () => {
    const { store, notes } = memoryFeedback();
    const server = await api(store);

    const sent = await server.inject({
      method: "POST",
      url: "/v1/feedback",
      headers: { authorization: await signIn("member-north") },
      payload: { text: "  The export button does nothing.  ", category: "bug", screen: "review" },
    });
    await server.inject({
      method: "POST",
      url: "/v1/feedback",
      headers: { authorization: await signIn("member-south") },
      payload: { text: "More templates, please.", screen: "home" },
    });

    expect(sent.statusCode).toBe(201);
    expect(sent.json()).toMatchObject({
      organisationId: "org-north",
      memberId: "member-north",
      category: "bug",
      screen: "review",
      text: "The export button does nothing.",
    });
    expect(notes.map(({ organisationId, category }) => [organisationId, category])).toEqual([
      ["org-north", "bug"],
      ["org-south", null],
    ]);

    const listed = await server.inject({
      method: "GET",
      url: "/v1/operator/feedback?limit=1",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().notes.map(({ text }: FeedbackNote) => text)).toEqual([
      "More templates, please.",
    ]);
  });

  it("keeps the operator list from members", async () => {
    const server = await api(memoryFeedback().store);

    const listed = await server.inject({
      method: "GET",
      url: "/v1/operator/feedback",
      headers: { authorization: await signIn("member-north") },
    });

    expect(listed.statusCode).toBe(401);
  });

  it("refuses an empty note, one over 2,000 characters and an unknown category", async () => {
    const { store, notes } = memoryFeedback();
    const server = await api(store);
    const authorization = await signIn("member-north");

    for (const payload of [
      { text: "   ", screen: "home" },
      { text: "x".repeat(2_001), screen: "home" },
      { text: "Fine.", screen: "home", category: "praise" },
      { text: "Fine.", screen: "<script>" },
    ]) {
      const response = await server.inject({
        method: "POST",
        url: "/v1/feedback",
        headers: { authorization },
        payload,
      });
      expect(response.statusCode).toBe(400);
    }
    expect(notes).toEqual([]);
  });

  it("answers 404 in owner-token mode, which has no members, and 401 without a credential", async () => {
    const server = await api(memoryFeedback().store, "owner");

    const asOwner = await server.inject({
      method: "POST",
      url: "/v1/feedback",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { text: "Hello.", screen: "home" },
    });
    const anonymous = await server.inject({
      method: "POST",
      url: "/v1/feedback",
      payload: { text: "Hello.", screen: "home" },
    });

    expect(asOwner.statusCode).toBe(404);
    expect(anonymous.statusCode).toBe(401);
  });
});
