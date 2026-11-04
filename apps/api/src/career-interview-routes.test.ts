import { type ApplicationService, WorkspaceNotFoundError } from "@draft-loop/application";
import type { AnthropicRouteBuilder } from "@draft-loop/model-gateway";
import { createMemoryCareerInterviewSessionStore } from "@draft-loop/storage/career-interview-sessions";
import type { ConsentLedger, ConsentState } from "@draft-loop/storage/consent-ledger";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { buildApi } from "./app.js";

const ownerToken = "owner-token-for-tests-0123456789abcdef";
const sessions = "/v1/workspaces/owner/career-interview/sessions";
const authorization = `Bearer ${ownerToken}`;

// An invented career record: one role without an outcome, and contact data the model never sees.
const profile = {
  updatedAt: "2026-11-05T08:00:00.000Z",
  facts: [
    { id: "t", category: "role", subjectId: "job", field: "title", value: "Analyst" },
    { id: "e", category: "employer", subjectId: "job", field: "name", value: "Example Bank" },
    { id: "d", category: "date", subjectId: "job", field: "dates", value: "2019 to 2022" },
    { id: "s", category: "role", subjectId: "job", field: "scope", value: "Loan reporting" },
    { id: "c", category: "contact", field: "email", value: "candidate@example.test" },
  ],
};

const service = {
  readWorkspace: async (root: string) => {
    if (root !== "/tenants/owner/workspaces/owner") throw new WorkspaceNotFoundError(root);
    return { id: "owner" };
  },
  listCanonicalCandidateProfileVersions: async () => [{ workspaceId: "owner", profile }],
  listApplications: async () => [],
} as unknown as ApplicationService;

const granted: ConsentState = {
  "provider-transmission": {
    id: "consent-1",
    workspaceId: "owner",
    kind: "provider-transmission",
    action: "granted",
    basis: "consent",
    providers: ["anthropic", "openai"],
    recordedBy: "owner",
    recordedAt: "2026-11-05T07:00:00.000Z",
  },
} as unknown as ConsentState;

function scriptedRoute(outputs: readonly object[], seen: unknown[]): AnthropicRouteBuilder {
  let call = 0;
  return () => ({
    provider: "anthropic",
    route: "anthropic-api",
    execute: async (request) => {
      seen.push(request.input);
      const output = outputs[call] ?? { text: "What else happened?", summary: "" };
      call += 1;
      return {
        output,
        contextSnapshotId: request.contextSnapshotId,
        provider: "anthropic",
        company: "anthropic",
        route: "anthropic-api",
        modelId: "claude-sonnet-5-5",
        providerRequestId: null,
        structuredOutputSha256: "0".repeat(64),
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        cost: { estimatedUsd: 0.001 },
      } as never;
    },
  });
}

let app: FastifyInstance;
let logs: string[];

async function build(options: {
  route?: AnthropicRouteBuilder;
  consent?: ConsentState;
}): Promise<void> {
  logs = [];
  const consents = {
    current: async () => options.consent ?? {},
  } as unknown as ConsentLedger;
  app = await buildApi({
    ownerToken,
    logger: { level: "info", stream: { write: (line: string) => logs.push(line) } },
    application: {
      service,
      workspaceRoot: (workspaceId) => `/tenants/owner/workspaces/${workspaceId}`,
      enqueueRun: async () => undefined,
      budgetCeiling: { maxRounds: 5, maxCostUsd: 3, maxDurationMs: 1_800_000 },
      monthUsage: async () => [],
      consents,
      careerInterview: {
        sessions: createMemoryCareerInterviewSessionStore(),
        allowProviderData: true,
        ...(options.route === undefined ? {} : { route: options.route }),
      },
    },
  });
}

const call = (method: "GET" | "POST", url: string, payload?: object) =>
  app.inject({
    method,
    url,
    headers: { authorization },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });

afterEach(async () => {
  await app.close();
});

describe("career interview routes", () => {
  it("starts a session with a proposal, talks a topic through and keeps logs content-free", async () => {
    const seen: unknown[] = [];
    await build({
      consent: granted,
      route: scriptedRoute([{ text: "What changed thanks to your work?", summary: "" }], seen),
    });
    const started = await call("POST", sessions);
    expect(started.statusCode).toBe(200);
    const body = started.json();
    expect(body.session.topics).toHaveLength(1);
    expect(body.proposal).toContain("Would you like to talk about it");
    const id = body.session.id as string;
    const key = body.session.topics[0].key as string;

    const accepted = await call("POST", `${sessions}/${id}/actions`, {
      action: "accept",
      topic_key: key,
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().session.topics[0].turns.at(-1).text).toBe(
      "What changed thanks to your work?",
    );
    expect(JSON.stringify(seen)).not.toContain("candidate@example.test");

    const answered = await call("POST", `${sessions}/${id}/actions`, {
      action: "answer",
      topic_key: key,
      text: "I rebuilt the loan reports.",
    });
    expect(answered.statusCode).toBe(200);
    expect((await call("GET", `${sessions}/${id}`)).json().session.topics[0].turns).toHaveLength(3);
    expect(logs.join("\n")).not.toContain("rebuilt the loan reports");
  });

  it("refuses a model turn without consent or without a model route", async () => {
    await build({ route: scriptedRoute([], []) });
    const started = (await call("POST", sessions)).json();
    const refused = await call("POST", `${sessions}/${started.session.id}/actions`, {
      action: "accept",
      topic_key: started.session.topics[0].key,
    });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.code).toBe("consent_required");
    await app.close();

    await build({ consent: granted });
    const again = (await call("POST", sessions)).json();
    const unavailable = await call("POST", `${sessions}/${again.session.id}/actions`, {
      action: "accept",
      topic_key: again.session.topics[0].key,
    });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json().error.code).toBe("interview_model_unavailable");
  });

  it("maps a closed topic and an unknown session to their codes", async () => {
    await build({ consent: granted, route: scriptedRoute([], []) });
    const started = (await call("POST", sessions)).json();
    const key = started.session.topics[0].key;
    await call("POST", `${sessions}/${started.session.id}/actions`, {
      action: "decline",
      topic_key: key,
    });
    const closed = await call("POST", `${sessions}/${started.session.id}/actions`, {
      action: "answer",
      topic_key: key,
      text: "Words",
    });
    expect(closed.statusCode).toBe(409);
    expect(closed.json().error.code).toBe("topic_not_open");
    const missing = await call("GET", `${sessions}/cis_doesnotexist01`);
    expect(missing.statusCode).toBe(404);
  });
});
