import type { FeedbackNote, FeedbackStore, SendFeedbackInput } from "@draft-loop/storage/feedback";
import { TenantDirectoryError } from "@draft-loop/storage/tenant-directory";
import Fastify, { type FastifyInstance } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { createLocalJWKSet, exportJWK, generateKeyPair, type JWTVerifyGetKey, SignJWT } from "jose";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { buildApi } from "./app.js";
import type { TenantEntitlementsFor } from "./entitlement-gate.js";
import type { FeedbackReplyMailer } from "./feedback-reply-mail.js";
import { registerFeedbackReplyRoutes } from "./feedback-reply-routes.js";
import { registerFeedbackRoutes } from "./feedback-routes.js";
import { cloudLoggingOptions } from "./logging.js";

const ownerToken = "owner-token-for-tests-0123456789abcdef";
const issuer = "https://id.example.test/realms/draft-loop";
const audience = "draft-loop-api";

const untriaged = { status: "new", issueUrl: null, triagedAt: null, replies: [] } as const;

/** Notes kept in memory, trimmed and bounded as the Postgres store does. */
function memoryFeedback() {
  const notes: FeedbackNote[] = [];
  const matching = (query: string | undefined) => {
    const text = query?.trim().toLowerCase() ?? "";
    return [...notes]
      .reverse()
      .filter(
        (note) =>
          text === "" ||
          `${note.text} ${note.screen} ${note.category ?? ""}`.toLowerCase().includes(text),
      );
  };
  const store: FeedbackStore = {
    send: async (input: SendFeedbackInput) => {
      const text = input.text.trim();
      if (text === "" || text.length > 2_000) {
        throw new TenantDirectoryError("invalid_input", "A note has 1 to 2000 characters.");
      }
      const note: FeedbackNote = {
        noteId: `note-${notes.length + 1}`,
        kind: "note",
        organisationId: input.organisationId,
        memberId: input.memberId,
        category: input.category,
        screen: input.screen,
        text,
        transcript: null,
        context: input.context ?? null,
        ...untriaged,
        sentAt: input.now.toISOString(),
      };
      notes.push(note);
      return note;
    },
    notesSentSince: async ({ organisationId, memberId, since }) =>
      notes.filter(
        (note) =>
          note.kind === "note" &&
          note.organisationId === organisationId &&
          note.memberId === memberId &&
          note.sentAt >= since.toISOString(),
      ).length,
    openSupportTicket: async (input) => {
      const note: FeedbackNote = {
        noteId: `note-${notes.length + 1}`,
        kind: "support",
        organisationId: input.organisationId,
        memberId: input.memberId,
        category: null,
        screen: "support",
        text: input.summary.trim(),
        transcript: [...input.transcript],
        context: null,
        ...untriaged,
        sentAt: input.now.toISOString(),
      };
      notes.push(note);
      return note;
    },
    listNewest: async (limit, status, page) =>
      matching(page?.query)
        .filter((note) => status === undefined || note.status === status)
        .slice(page?.offset ?? 0, (page?.offset ?? 0) + limit),
    get: async (noteId) => notes.find((note) => note.noteId === noteId),
    statusCounts: async (query) => {
      const counts = { new: 0, triaged: 0, issue: 0, closed: 0 };
      for (const note of matching(query)) counts[note.status] += 1;
      return counts;
    },
    triage: async ({ noteId, status, issueUrl, now }) => {
      const index = notes.findIndex((note) => note.noteId === noteId);
      const current = notes[index];
      if (current === undefined) return undefined;
      const link = issueUrl === undefined ? current.issueUrl : issueUrl;
      if (status === "issue" && link === null) {
        throw new TenantDirectoryError("invalid_input", "Status issue needs an issue link.");
      }
      const note: FeedbackNote = {
        ...current,
        status,
        issueUrl: link,
        triagedAt: status === "new" ? null : now.toISOString(),
      };
      notes[index] = note;
      return note;
    },
    addReply: async ({ noteId, text, now }) => {
      const index = notes.findIndex((note) => note.noteId === noteId);
      const current = notes[index];
      if (current === undefined) return undefined;
      const note: FeedbackNote = {
        ...current,
        replies: [...current.replies, { text: text.trim(), sentAt: now.toISOString() }],
      };
      notes[index] = note;
      return note;
    },
    deleteSupportTicketsBefore: async () => 0,
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

let logLines: Record<string, unknown>[] = [];

async function api(feedback: FeedbackStore, mode: "owner" | "oidc" = "oidc") {
  logLines = [];
  app = await buildApi({
    ownerToken,
    logger: cloudLoggingOptions({
      write: (line) => logLines.push(JSON.parse(line) as Record<string, unknown>),
    }),
    feedback,
    serverRelease: "server-v0.40.0",
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
  it("refuses a member's note past 20 in 24 hours with 429, and counts each member apart (#2958)", async () => {
    const { store, notes } = memoryFeedback();
    const server = await api(store);
    const send = async (subject: string) =>
      server.inject({
        method: "POST",
        url: "/v1/feedback",
        headers: { authorization: await signIn(subject) },
        payload: { text: "Another note.", screen: "home" },
      });

    for (let index = 0; index < 20; index += 1) {
      expect((await send("member-north")).statusCode).toBe(201);
    }
    const refused = await send("member-north");

    expect(refused.statusCode).toBe(429);
    expect(refused.json().error.code).toBe("feedback_cap_reached");
    expect(refused.headers["retry-after"]).toBe("3600");
    expect(notes).toHaveLength(20);
    expect((await send("member-south")).statusCode).toBe(201);
  });

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
    // The operator's read is audited, with counts and never a note's text (#2954).
    expect(logLines.flatMap((line) => (line.audit === undefined ? [] : [line.audit]))).toEqual([
      { action: "feedback_listed", actor: "owner-token", listed: 1, searched: false },
    ]);
    expect(JSON.stringify(logLines)).not.toContain("More templates");
  });

  it("pages and searches the operator list, with each status's count for the search", async () => {
    const { store } = memoryFeedback();
    const server = await api(store);
    const authorization = await signIn("member-north");
    for (const text of ["Export is slow.", "Export fails.", "Love the templates."]) {
      await server.inject({
        method: "POST",
        url: "/v1/feedback",
        headers: { authorization },
        payload: { text, screen: "review" },
      });
    }
    const operator = { authorization: `Bearer ${ownerToken}` };

    const second = await server.inject({
      method: "GET",
      url: "/v1/operator/feedback?limit=1&offset=1&q=EXPORT",
      headers: operator,
    });

    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({
      total: 2,
      counts: { new: 2, triaged: 0, issue: 0, closed: 0 },
    });
    expect(second.json().notes.map(({ text }: FeedbackNote) => text)).toEqual(["Export is slow."]);
    const tooLong = await server.inject({
      method: "GET",
      url: `/v1/operator/feedback?q=${"a".repeat(201)}`,
      headers: operator,
    });
    expect(tooLong.statusCode).toBe(400);
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

const clientContext = {
  route: "/#review",
  webBuild: "index-a1b2c3",
  ids: { recordId: "record-1", applicationId: "application-2", runId: "run-7" },
  recentErrors: [{ code: "not_found", message: "No such run.", at: "2026-11-16T09:59:00.000Z" }],
  lastFailedRequestId: "3f0c2a8e-1b2c-4d5e-8f90-123456789abc",
  browser: {
    family: "Firefox",
    os: "Linux",
    viewport: "1280x800",
    language: "fr-FR",
    theme: "dark" as const,
  },
};

describe("a note's context (#2875)", () => {
  it("stores the client's context with the server's own facts and returns it to the operator", async () => {
    const { store } = memoryFeedback();
    const server = await api(store);

    const sent = await server.inject({
      method: "POST",
      url: "/v1/feedback",
      headers: { authorization: await signIn("member-north") },
      payload: { text: "The run page is blank.", screen: "review", context: clientContext },
    });

    expect(sent.statusCode).toBe(201);
    // Every answer names its request, so a later note can cite the one that failed.
    expect(sent.headers["x-request-id"]).toMatch(/^[0-9a-f]{32}$/u);
    expect(sent.json().context).toEqual({
      ...clientContext,
      source: "web",
      serverRelease: "server-v0.40.0",
      plan: null,
    });
    const listed = await server.inject({
      method: "GET",
      url: "/v1/operator/feedback",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(listed.json().notes[0].context).toEqual(sent.json().context);
  });

  it("records a note without a context with the server's facts only", async () => {
    const server = await api(memoryFeedback().store);

    const sent = await server.inject({
      method: "POST",
      url: "/v1/feedback",
      headers: { authorization: await signIn("member-north") },
      payload: { text: "Hello.", screen: "home" },
    });

    expect(sent.json().context).toEqual({
      source: "web",
      serverRelease: "server-v0.40.0",
      plan: null,
    });
  });

  it("refuses a context over its size, with unknown fields, server facts or a query in the route", async () => {
    const { store, notes } = memoryFeedback();
    const server = await api(store);
    const authorization = await signIn("member-north");
    const error = { code: "invalid_input", message: "x".repeat(200), at: "2026-11-16T09:59:00Z" };
    const escaped = { ...error, message: "\u0001".repeat(200) };

    for (const context of [
      // Each field is within its bounds, but escaped characters push the whole past its size.
      { ...clientContext, recentErrors: Array.from({ length: 5 }, () => escaped) },
      { ...clientContext, recentErrors: Array.from({ length: 6 }, () => error) },
      { ...clientContext, pageText: "Senior engineer at Example Corp" },
      { ...clientContext, plan: "pro" },
      { ...clientContext, source: "agent" },
      { ...clientContext, route: "/review?name=Jane" },
      { ...clientContext, recentErrors: [{ ...error, body: "{}" }] },
    ]) {
      const response = await server.inject({
        method: "POST",
        url: "/v1/feedback",
        headers: { authorization },
        payload: { text: "Fine.", screen: "home", context },
      });
      expect(response.statusCode).toBe(400);
    }
    expect(notes).toEqual([]);
  });

  it("reads the plan from the organisation, never from the client", async () => {
    const { store } = memoryFeedback();
    const server = Fastify().withTypeProvider<ZodTypeProvider>();
    server.setValidatorCompiler(validatorCompiler);
    server.setSerializerCompiler(serializerCompiler);
    server.decorateRequest("caller", undefined);
    server.addHook("onRequest", async (request) => {
      request.caller = {
        kind: "member",
        tenantId: "org-north",
        memberId: "member-1",
        role: "member",
      };
    });
    registerFeedbackRoutes(server, {
      feedback: store,
      serverRelease: null,
      entitlementsFor: (tenantId) =>
        ({
          assignment: async () => ({ planId: tenantId === "org-north" ? "pro" : "free" }),
        }) as unknown as ReturnType<TenantEntitlementsFor>,
    });
    try {
      const sent = await server.inject({
        method: "POST",
        url: "/v1/workspaces/record-1/feedback",
        payload: { text: "From my agent.", screen: "agent" },
      });

      expect(sent.statusCode).toBe(201);
      expect(sent.json().context).toEqual({ source: "agent", serverRelease: null, plan: "pro" });
    } finally {
      await server.close();
    }
  });
});

describe("triaging notes (#2877)", () => {
  const issueUrl = "https://github.com/example-org/example-repo/issues/12";

  async function withNote() {
    const { store } = memoryFeedback();
    const server = await api(store);
    const sent = await server.inject({
      method: "POST",
      url: "/v1/feedback",
      headers: { authorization: await signIn("member-north") },
      payload: { text: "The export button does nothing.", screen: "review" },
    });
    return { server, noteId: sent.json().noteId as string };
  }

  it("lets the operator set a status and an issue link, and filter the list by status", async () => {
    const { server, noteId } = await withNote();
    const operator = { authorization: `Bearer ${ownerToken}` };

    const triaged = await server.inject({
      method: "PATCH",
      url: `/v1/operator/feedback/${noteId}`,
      headers: operator,
      payload: { status: "issue", issueUrl },
    });

    expect(triaged.statusCode).toBe(200);
    expect(triaged.json()).toMatchObject({ noteId, status: "issue", issueUrl });
    expect(triaged.json().triagedAt).toEqual(expect.any(String));
    const issues = await server.inject({
      method: "GET",
      url: "/v1/operator/feedback?status=issue",
      headers: operator,
    });
    const fresh = await server.inject({
      method: "GET",
      url: "/v1/operator/feedback?status=new",
      headers: operator,
    });
    expect(issues.json().notes.map((note: FeedbackNote) => note.noteId)).toEqual([noteId]);
    expect(fresh.json().notes).toEqual([]);
    const one = await server.inject({
      method: "GET",
      url: `/v1/operator/feedback/${noteId}`,
      headers: operator,
    });
    expect(one.json()).toMatchObject({ noteId, status: "issue" });
    expect(logLines.map((line) => line.audit)).toContainEqual({
      action: "feedback_read",
      actor: "owner-token",
      noteId,
      organisationId: "org-north",
    });
    const unknown = await server.inject({
      method: "GET",
      url: "/v1/operator/feedback/no-such-note",
      headers: operator,
    });
    expect(unknown.statusCode).toBe(404);
  });

  it("refuses a link that is not an https GitHub issue, status issue without one and an unknown note", async () => {
    const { server, noteId } = await withNote();
    const operator = { authorization: `Bearer ${ownerToken}` };

    for (const payload of [
      { status: "issue", issueUrl: "http://github.com/example-org/example-repo/issues/12" },
      { status: "issue", issueUrl: "https://example.test/example-org/example-repo/issues/12" },
      { status: "issue", issueUrl: "https://github.com/example-org/example-repo/pull/12" },
      { status: "issue" },
      { status: "done" },
    ]) {
      const response = await server.inject({
        method: "PATCH",
        url: `/v1/operator/feedback/${noteId}`,
        headers: operator,
        payload,
      });
      expect(response.statusCode).toBe(400);
    }
    const unknown = await server.inject({
      method: "PATCH",
      url: "/v1/operator/feedback/no-such-note",
      headers: operator,
      payload: { status: "triaged" },
    });
    expect(unknown.statusCode).toBe(404);
  });

  it("keeps triage from members", async () => {
    const { server, noteId } = await withNote();

    const response = await server.inject({
      method: "PATCH",
      url: `/v1/operator/feedback/${noteId}`,
      headers: { authorization: await signIn("member-north") },
      payload: { status: "closed" },
    });

    expect(response.statusCode).toBe(401);
  });
});

describe("replying to a note (#2878)", () => {
  const now = new Date("2026-11-21T10:00:00.000Z");
  const noteId = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

  async function replyApi(options: {
    readonly mailer?: FeedbackReplyMailer;
    readonly email?: string;
    readonly language?: string;
  }) {
    const { store, notes } = memoryFeedback();
    notes.push({
      noteId,
      kind: "note",
      organisationId: "org-north",
      memberId: "member-north",
      category: "bug",
      screen: "review",
      text: "The export button does nothing.",
      transcript: null,
      context:
        options.language === undefined
          ? null
          : {
              source: "web",
              serverRelease: null,
              plan: null,
              browser: {
                family: "Firefox",
                os: "Linux",
                viewport: "1280x800",
                language: options.language,
                theme: "light",
              },
            },
      ...untriaged,
      sentAt: now.toISOString(),
    });
    const server = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
    server.setValidatorCompiler(validatorCompiler);
    server.setSerializerCompiler(serializerCompiler);
    registerFeedbackReplyRoutes(server, {
      feedback: store,
      ...(options.mailer === undefined ? {} : { mailer: options.mailer }),
      memberEmail: async (organisationId, memberId) =>
        organisationId === "org-north" && memberId === "member-north" ? options.email : undefined,
      now: () => now,
    });
    app = server;
    return { server, notes };
  }

  it("emails the reply to the member in their language and keeps it with the note", async () => {
    const sent: Parameters<FeedbackReplyMailer>[0][] = [];
    const { server } = await replyApi({
      email: "member@example.test",
      language: "fr-FR",
      mailer: async (message) => {
        sent.push(message);
        return true;
      },
    });

    const response = await server.inject({
      method: "POST",
      url: `/v1/operator/feedback/${noteId}/reply`,
      payload: { text: "  Thanks, it is fixed in the next release.  " },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().replies).toEqual([
      { text: "Thanks, it is fixed in the next release.", sentAt: now.toISOString() },
    ]);
    // The address goes to the mailer only, never into the response.
    expect(response.body).not.toContain("member@example.test");
    expect(sent).toEqual([
      {
        email: "member@example.test",
        reference: "FB-1A2B3C4D",
        text: "Thanks, it is fixed in the next release.",
        locale: "fr",
      },
    ]);
  });

  it("stores nothing when the mail fails, and says why it cannot reply", async () => {
    const failing = await replyApi({ email: "member@example.test", mailer: async () => false });
    const failed = await failing.server.inject({
      method: "POST",
      url: `/v1/operator/feedback/${noteId}/reply`,
      payload: { text: "Hello." },
    });
    expect(failed.statusCode).toBe(502);
    expect(failed.json().error.code).toBe("mail_failed");
    expect(failing.notes[0]?.replies).toEqual([]);
    await app?.close();

    const noMail = await replyApi({ email: "member@example.test" });
    const unavailable = await noMail.server.inject({
      method: "POST",
      url: `/v1/operator/feedback/${noteId}/reply`,
      payload: { text: "Hello." },
    });
    expect(unavailable.statusCode).toBe(503);
    await app?.close();

    const gone = await replyApi({ mailer: async () => true });
    const goneResponse = await gone.server.inject({
      method: "POST",
      url: `/v1/operator/feedback/${noteId}/reply`,
      payload: { text: "Hello." },
    });
    expect(goneResponse.statusCode).toBe(404);
    expect(goneResponse.json().error.code).toBe("member_gone");
    for (const [url, payload, status] of [
      ["/v1/operator/feedback/no-such-note/reply", { text: "Hello." }, 404],
      [`/v1/operator/feedback/${noteId}/reply`, { text: "   " }, 400],
      [`/v1/operator/feedback/${noteId}/reply`, { text: "x".repeat(2_001) }, 400],
    ] as const) {
      const response = await gone.server.inject({ method: "POST", url, payload });
      expect(response.statusCode).toBe(status);
    }
  });

  it("keeps the reply route from members", async () => {
    const { store } = memoryFeedback();
    const server = await api(store);

    const response = await server.inject({
      method: "POST",
      url: `/v1/operator/feedback/${noteId}/reply`,
      headers: { authorization: await signIn("member-north") },
      payload: { text: "Hello." },
    });

    expect(response.statusCode).toBe(401);
  });
});
