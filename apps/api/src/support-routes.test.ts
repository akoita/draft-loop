import { type ApplicationService, WorkspaceNotFoundError } from "@draft-loop/application";
import type { AnthropicRouteBuilder } from "@draft-loop/model-gateway";
import type { FeedbackStore, OpenSupportTicketInput } from "@draft-loop/storage/feedback";
import Fastify, { type FastifyInstance } from "fastify";
import { validatorCompiler } from "fastify-type-provider-zod";
import { afterEach, describe, expect, it } from "vitest";

import { buildApi } from "./app.js";
import { readSupportSettings, type SupportSettings } from "./support-config.js";
import { createMemorySupportLedger, registerSupportRoutes } from "./support-routes.js";

const ownerToken = "owner-token-for-tests-0123456789abcdef";
const owner = { authorization: `Bearer ${ownerToken}` };
const conversations = "/v1/workspaces/owner/support/conversations";

const service = {
  readWorkspace: async (root: string) => {
    if (root !== "/tenants/owner/workspaces/owner") throw new WorkspaceNotFoundError(root);
    return { id: "owner" };
  },
  listApplications: async () => [
    {
      id: "app_1",
      runs: [
        {
          id: "run_old",
          state: "completed",
          startedAt: "2026-11-01T00:00:00Z",
          updatedAt: "2026-11-01T01:00:00Z",
        },
        {
          id: "run_new",
          state: "failed",
          startedAt: "2026-11-17T09:00:00Z",
          updatedAt: "2026-11-17T10:00:00Z",
        },
      ],
    },
  ],
  status: async ({ runId }: { runId: string }) =>
    runId === "run_new"
      ? {
          runId,
          state: "failed",
          updatedAt: "2026-11-17T10:00:00Z",
          lastError: {
            code: "provider-overloaded",
            retryable: true,
            usageLimitResetsAt: "2026-11-17T12:02:00Z",
          },
        }
      : runId === "run_old"
        ? { runId, state: "completed", updatedAt: "2026-11-01T01:00:00Z", lastError: null }
        : undefined,
} as unknown as ApplicationService;

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

/** A Claude route that plays scripted steps and keeps each request. */
function scriptedRoute(steps: readonly Record<string, unknown>[]) {
  const requests: {
    systemPrompt: string;
    input: Record<string, unknown>;
    model: { modelId: string };
  }[] = [];
  let index = 0;
  const builder: AnthropicRouteBuilder = (() => ({
    provider: "anthropic",
    route: "vertex",
    execute: async (request: (typeof requests)[number]) => {
      requests.push(request);
      const output = steps[index];
      index += 1;
      if (output === undefined) throw new Error("script exhausted");
      return {
        output,
        company: "anthropic",
        modelId: "claude-haiku-5-5",
        route: "vertex",
        usage: { inputTokens: 1200, outputTokens: 90 },
        cost: { estimatedUsd: 0.0015 },
      };
    },
  })) as unknown as AnthropicRouteBuilder;
  return { builder, requests };
}

async function start(settings: Partial<SupportSettings>, route?: AnthropicRouteBuilder) {
  app = await buildApi({
    ownerToken,
    logger: false,
    support: { ...readSupportSettings({ DRAFT_LOOP_SUPPORT_ASSISTANT: "on" }), ...settings },
    application: {
      service,
      workspaceRoot: (workspaceId) => `/tenants/owner/workspaces/${workspaceId}`,
      enqueueRun: async () => undefined,
      budgetCeiling: { maxRounds: 5, maxCostUsd: 3, maxDurationMs: 1_800_000 },
      monthUsage: async () => [],
      ...(route === undefined
        ? {}
        : { careerInterview: { sessions: {} as never, allowProviderData: true, route } }),
    },
  } as Parameters<typeof buildApi>[0]);
  return app;
}

async function ask(api: FastifyInstance, question: string, language = "en") {
  const opened = await api.inject({ method: "POST", url: conversations, headers: owner });
  expect(opened.statusCode).toBe(201);
  const id = opened.json().conversation_id as string;
  return api.inject({
    method: "POST",
    url: `${conversations}/${id}/messages`,
    headers: owner,
    payload: { question, language },
  });
}

describe("the support routes (#2882)", () => {
  it("answer through the Claude route, reading the record's runs", async () => {
    const { builder, requests } = scriptedRoute([
      { step: "tool", tool: "list_recent_runs", query: null, run_id: null, summary: null },
      {
        step: "answer",
        answer: "Your last run met a busy model; it retries by itself in about two minutes.",
        section_ids: ["problems"],
        outcome: "answered",
      },
    ]);
    const api = await start({}, builder);

    const opened = await api.inject({ method: "POST", url: conversations, headers: owner });
    expect(opened.json()).toMatchObject({ assistant_available: true });
    const response = await ask(api, "Why did my CV run fail?");

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      mode: "assistant",
      outcome: "answered",
      reason: null,
      text: "Your last run met a busy model; it retries by itself in about two minutes.",
      sections: [{ id: "problems", title: "When something goes wrong", paragraphs: [] }],
      ticket_id: null,
    });
    expect(requests[0]?.model.modelId).toBe("claude-haiku-5-5");
    const runs = (requests[1]?.input.tool_results as { result: unknown }[] | undefined)?.[0]
      ?.result;
    expect(runs).toEqual([
      {
        run_id: "run_new",
        application_id: "app_1",
        state: "failed",
        error_code: "provider-overloaded",
        recoverable: true,
        wait_seconds: expect.any(Number),
        updated_at: "2026-11-17T10:00:00Z",
      },
      {
        run_id: "run_old",
        application_id: "app_1",
        state: "completed",
        error_code: null,
        recoverable: null,
        wait_seconds: null,
        updated_at: "2026-11-01T01:00:00Z",
      },
    ]);
    expect(requests[0]?.systemPrompt).toContain("DraftLoop user guide");
  });

  it("answer with guide search when the switch is off, without calling the route", async () => {
    const { builder, requests } = scriptedRoute([]);
    const api = await start({ enabled: false }, builder);

    const opened = await api.inject({ method: "POST", url: conversations, headers: owner });
    expect(opened.json()).toMatchObject({ assistant_available: false });
    const response = await ask(api, "Comment exporter mon CV en PDF ?", "fr");

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({
      mode: "guide_search",
      reason: "disabled",
      outcome: null,
      text: null,
    });
    expect(body.sections[0]).toMatchObject({ id: "review", title: "Relire et exporter" });
    expect(body.sections[0].paragraphs.length).toBeGreaterThan(0);
    expect(requests).toHaveLength(0);
  });

  it("answer with guide search when the server has no Claude route", async () => {
    const api = await start({});
    const response = await ask(api, "How do I add a job?");
    expect(response.json()).toMatchObject({ mode: "guide_search", reason: "disabled" });
  });

  it("refuse a question over 1000 characters and a malformed conversation id", async () => {
    const api = await start({});
    const opened = await api.inject({ method: "POST", url: conversations, headers: owner });
    const id = opened.json().conversation_id as string;
    const long = await api.inject({
      method: "POST",
      url: `${conversations}/${id}/messages`,
      headers: owner,
      payload: { question: "x".repeat(1001), language: "en" },
    });
    expect(long.statusCode).toBe(400);
    const bad = await api.inject({
      method: "POST",
      url: `${conversations}/nope/messages`,
      headers: owner,
      payload: { question: "Hi", language: "en" },
    });
    expect(bad.statusCode).toBe(400);
  });

  it("refuse a caller without a credential", async () => {
    const api = await start({});
    const response = await api.inject({ method: "POST", url: conversations });
    expect(response.statusCode).toBe(401);
  });
});

describe("handing a support conversation to a person (#2883)", () => {
  const transcript = [
    { role: "member", text: "I was charged twice for a credit pack." },
    { role: "assistant", text: "I cannot see payments. Select Talk to a person." },
  ];

  /** The routes alone, with a signed-in member as the caller. */
  async function memberApp(opened: OpenSupportTicketInput[]) {
    const server = Fastify({ logger: false });
    server.setValidatorCompiler(validatorCompiler);
    server.setSerializerCompiler(() => (data) => JSON.stringify(data));
    server.decorateRequest("caller", undefined);
    server.addHook("onRequest", async (request) => {
      (request as { caller?: unknown }).caller = {
        kind: "member",
        tenantId: "org-north",
        memberId: "member-1",
        role: "member",
      };
    });
    const feedback: Pick<FeedbackStore, "openSupportTicket"> = {
      openSupportTicket: async (input) => {
        opened.push(input);
        return {
          noteId: "ticket-1",
          kind: "support",
          organisationId: input.organisationId,
          memberId: input.memberId,
          category: null,
          screen: "support",
          text: input.summary,
          transcript: input.transcript,
          sentAt: input.now.toISOString(),
        };
      },
    };
    registerSupportRoutes(server, {
      settings: readSupportSettings({}),
      service,
      workspaceRoot: (workspaceId) => `/tenants/org-north/workspaces/${workspaceId}`,
      route: () => undefined,
      feedback,
      now: () => new Date("2026-11-17T12:00:00Z"),
    });
    app = server;
    return server;
  }

  it("stores the conversation as a ticket in the member's organisation, with consent", async () => {
    const opened: OpenSupportTicketInput[] = [];
    const server = await memberApp(opened);

    const response = await server.inject({
      method: "POST",
      url: `${conversations}/sup_0123456789/handoff`,
      payload: { consent: true, transcript },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ ticket_id: "ticket-1" });
    expect(opened).toEqual([
      {
        organisationId: "org-north",
        memberId: "member-1",
        summary:
          "Support conversation of 2 turns, handed to a person. First question: I was charged twice for a credit pack.",
        transcript,
        now: new Date("2026-11-17T12:00:00Z"),
      },
    ]);
  });

  it("refuses without consent or with an empty conversation", async () => {
    const opened: OpenSupportTicketInput[] = [];
    const server = await memberApp(opened);
    for (const payload of [
      { consent: false, transcript },
      { consent: true, transcript: [] },
      { transcript },
    ]) {
      const response = await server.inject({
        method: "POST",
        url: `${conversations}/sup_0123456789/handoff`,
        payload,
      });
      expect(response.statusCode).toBe(400);
    }
    expect(opened).toEqual([]);
  });

  it("answers 404 to the owner token, which has no organisation", async () => {
    const api = await start({});
    const response = await api.inject({
      method: "POST",
      url: `${conversations}/sup_0123456789/handoff`,
      headers: owner,
      payload: { consent: true, transcript },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe("the support settings and ledger (#2882)", () => {
  it("default to off, with the package's limits", () => {
    expect(readSupportSettings({})).toEqual({
      enabled: false,
      memberDailyQuestions: 20,
      dailyCostCapUsd: 2,
      serviceStatus: { state: "operational", codes: [] },
    });
    expect(
      readSupportSettings({
        DRAFT_LOOP_SUPPORT_ASSISTANT: "on",
        DRAFT_LOOP_SUPPORT_MEMBER_DAILY_QUESTIONS: "5",
        DRAFT_LOOP_SUPPORT_DAILY_COST_USD: "0.5",
        DRAFT_LOOP_SUPPORT_SERVICE_STATE: "degraded",
        DRAFT_LOOP_SUPPORT_SERVICE_CODES: "model-route-slow, sign-in-slow",
      }),
    ).toEqual({
      enabled: true,
      memberDailyQuestions: 5,
      dailyCostCapUsd: 0.5,
      serviceStatus: { state: "degraded", codes: ["model-route-slow", "sign-in-slow"] },
    });
  });

  it("refuse invalid values", () => {
    expect(() => readSupportSettings({ DRAFT_LOOP_SUPPORT_ASSISTANT: "yes" })).toThrow(
      /on or off/u,
    );
    expect(() => readSupportSettings({ DRAFT_LOOP_SUPPORT_MEMBER_DAILY_QUESTIONS: "0" })).toThrow();
    expect(() => readSupportSettings({ DRAFT_LOOP_SUPPORT_DAILY_COST_USD: "-1" })).toThrow();
    expect(() => readSupportSettings({ DRAFT_LOOP_SUPPORT_SERVICE_STATE: "fine" })).toThrow();
    expect(() => readSupportSettings({ DRAFT_LOOP_SUPPORT_SERVICE_CODES: "Bad Code" })).toThrow();
  });

  it("count questions per member and cost per day, and reset at the UTC day", async () => {
    let now = new Date("2026-11-17T23:59:00Z");
    const ledger = createMemorySupportLedger(() => now);
    await ledger.countQuestion("m1");
    await ledger.countQuestion("m1");
    await ledger.record({
      memberId: "m1",
      conversationId: "c",
      modelId: "claude-haiku-5-5",
      inputTokens: 1,
      outputTokens: 1,
      estimatedUsd: 0.25,
      at: now.toISOString(),
    });
    expect(await ledger.questionsToday("m1")).toBe(2);
    expect(await ledger.questionsToday("m2")).toBe(0);
    expect(await ledger.costTodayUsd()).toBe(0.25);
    now = new Date("2026-11-18T00:01:00Z");
    expect(await ledger.questionsToday("m1")).toBe(0);
    expect(await ledger.costTodayUsd()).toBe(0);
  });
});
