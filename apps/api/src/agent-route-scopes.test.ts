import { type ApplicationService, WorkspaceNotFoundError } from "@draft-loop/application";
import { createWorkJournalService } from "@draft-loop/application/work-journal";
import {
  type AgentTokenScope,
  createMemoryAgentTokenStore,
} from "@draft-loop/storage/agent-tokens";
import { createMemoryWorkJournalNoteStore } from "@draft-loop/storage/work-journal-notes";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { agentRoutes, humanOnlyRoutes } from "./agent-route-scopes.js";
import { buildApi } from "./app.js";

const ownerToken = "owner-token-for-tests-0123456789abcdef";
const owner = { authorization: `Bearer ${ownerToken}` };
const applications = "/v1/workspaces/owner/applications";

let app: FastifyInstance;
let created: unknown[];

beforeEach(async () => {
  created = [];
  const service = {
    readWorkspace: async (root: string) => {
      if (root !== "/tenants/owner/workspaces/owner") throw new WorkspaceNotFoundError(root);
      return { id: "owner" };
    },
    listApplications: async () => [],
    createApplication: async (input: unknown) => {
      created.push(input);
      throw new Error("stub: not stored");
    },
  } as unknown as ApplicationService;
  app = await buildApi({
    ownerToken,
    logger: false,
    agentTokens: createMemoryAgentTokenStore(),
    application: {
      service,
      workspaceRoot: (workspaceId) => `/tenants/owner/workspaces/${workspaceId}`,
      enqueueRun: async () => undefined,
      budgetCeiling: { maxRounds: 5, maxCostUsd: 3, maxDurationMs: 1_800_000 },
      monthUsage: async () => [],
      workJournal: createWorkJournalService({
        store: createMemoryWorkJournalNoteStore(),
        tenantId: "owner",
      }),
    },
  });
});

afterEach(async () => {
  await app.close();
});

async function agentWith(scopes?: readonly AgentTokenScope[]) {
  const issued = await app.inject({
    method: "POST",
    url: "/v1/workspaces/owner/agent-tokens",
    headers: owner,
    payload: { label: "Claude Code", ...(scopes === undefined ? {} : { scopes }) },
  });
  expect(issued.statusCode).toBe(201);
  return {
    headers: { authorization: `Bearer ${issued.json().token as string}` },
    scopes: issued.json().scopes as string[],
  };
}

describe("agent route scopes", () => {
  it("classify every route of the API, so a new one is refused to agents until decided", async () => {
    await app.ready();
    const document = app.swagger() as { paths: Record<string, Record<string, unknown>> };
    const operations = Object.entries(document.paths).flatMap(([template, methods]) =>
      Object.keys(methods).map(
        (method) => `${method.toUpperCase()} ${template.replace(/\{([^}]+)\}/gu, ":$1")}`,
      ),
    );
    const classified = new Set([...Object.keys(agentRoutes), ...humanOnlyRoutes]);
    const unclassified = operations.filter((operation) => !classified.has(operation));
    expect(unclassified, "add each to agentRoutes or humanOnlyRoutes").toEqual([]);
    for (const route of Object.keys(agentRoutes)) {
      expect(humanOnlyRoutes, route).not.toContain(route);
    }
    expect(new Set(humanOnlyRoutes).size).toBe(humanOnlyRoutes.length);
  });

  it("keep decisions, consent, settings and tokens human-only", () => {
    for (const route of [
      "POST /v1/workspaces/:workspaceId/runs/:runId/approve",
      "PUT /v1/workspaces/:workspaceId/runs/:runId/findings/:findingId/decision",
      "POST /v1/workspaces/:workspaceId/consents",
      "POST /v1/workspaces/:workspaceId/agent-tokens",
      "PUT /v1/workspaces/:workspaceId/budget",
      "POST /v1/workspaces/:workspaceId/work-journal/notes/:noteId/review",
      "POST /v1/workspaces/:workspaceId/career-interview/sessions",
    ]) {
      expect(humanOnlyRoutes, route).toContain(route);
    }
  });

  it("give a token the journal only unless other scopes are asked for", async () => {
    const journal = await agentWith();
    expect(journal.scopes).toEqual(["journal"]);
    const refused = await app.inject({
      method: "GET",
      url: applications,
      headers: journal.headers,
    });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.message).toContain('"applications:read" scope');
  });

  it("list applications with applications:read, and refuse a job without jobs:write", async () => {
    const reader = await agentWith(["applications:read"]);
    const listed = await app.inject({ method: "GET", url: applications, headers: reader.headers });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual({ applications: [] });
    const refused = await app.inject({
      method: "POST",
      url: applications,
      headers: reader.headers,
      payload: { name: "Platform engineer", jobText: "A fictional job." },
    });
    expect(refused.statusCode).toBe(403);
    expect(created).toEqual([]);
  });

  it("add a job from pasted text with jobs:write, never from a job page address", async () => {
    const writer = await agentWith(["jobs:write", "journal"]);
    expect(writer.scopes).toEqual(["journal", "jobs:write"]);
    const page = await app.inject({
      method: "POST",
      url: applications,
      headers: writer.headers,
      payload: {
        name: "Platform engineer",
        jobUrl: "https://jobs.example.com/platform-engineer",
        jobUrlApproved: true,
      },
    });
    expect(page.statusCode).toBe(403);
    expect(page.json().error.message).toContain("approval");
    expect(created).toEqual([]);

    await app.inject({
      method: "POST",
      url: applications,
      headers: writer.headers,
      payload: { name: "Platform engineer", jobText: "A fictional job." },
    });
    expect(created).toMatchObject([
      { jobSource: { kind: "pasted-text", text: "A fictional job." } },
    ]);
  });

  it("read exports and saved material only with drafts:read, which no token gets unasked", async () => {
    const reader = await agentWith(["applications:read"]);
    for (const url of [
      "/v1/workspaces/owner/runs/run-1/exports",
      "/v1/workspaces/owner/runs/run-1/exports/export-1/content",
    ]) {
      const refused = await app.inject({ method: "GET", url, headers: reader.headers });
      expect(refused.statusCode, url).toBe(403);
      expect(refused.json().error.message, url).toContain('"drafts:read" scope');
    }
    // This test API keeps no drafts, so the material route is checked by its rule.
    expect(
      agentRoutes["GET /v1/workspaces/:workspaceId/applications/:applicationId/material"]?.scope,
    ).toBe("drafts:read");
    expect(agentRoutes["GET /v1/workspaces/:workspaceId/runs/:runId/review"]).toBeUndefined();
    expect(humanOnlyRoutes).toContain("GET /v1/workspaces/:workspaceId/runs/:runId/review");
    expect(humanOnlyRoutes).toContain(
      "GET /v1/workspaces/:workspaceId/applications/:applicationId/material/:materialId/document",
    );
  });

  it("refuse an unknown scope at issue", async () => {
    const refused = await app.inject({
      method: "POST",
      url: "/v1/workspaces/owner/agent-tokens",
      headers: owner,
      payload: { label: "Claude Code", scopes: ["runs"] },
    });
    expect(refused.statusCode).toBe(400);
  });
});
