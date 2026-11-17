import { type ApplicationService, WorkspaceNotFoundError } from "@draft-loop/application";
import { createWorkJournalService } from "@draft-loop/application/work-journal";
import {
  type AgentTokenScope,
  createMemoryAgentTokenStore,
} from "@draft-loop/storage/agent-tokens";
import { createMemoryWorkJournalNoteStore } from "@draft-loop/storage/work-journal-notes";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApi } from "./app.js";

const ownerToken = "owner-token-for-tests-0123456789abcdef";
const owner = { authorization: `Bearer ${ownerToken}` };
const projects = "/v1/workspaces/owner/work-journal/projects";

// A fictional repository only.
const card = {
  name: "Tidewater",
  purpose: "A command-line tool that plans tide-safe kayak trips",
  summary:
    "Tidewater reads public tide tables and proposes launch windows for a kayak route, with offline caching and a plain-text report.",
  role: "sole-author",
  visibility: "public",
  stack: ["TypeScript", "SQLite"],
  contribution: {
    own_commits: 412,
    total_commits: 430,
    first_commit: "2025-10-02",
    last_commit: "2026-11-10",
    other_contributors: 2,
  },
  highlights: [{ text: "Caches tide tables for offline trips", source: "README.md" }],
  repository_url: "https://git.example.test/tidewater/tidewater",
};

let app: FastifyInstance;
let logs: string[];

beforeEach(async () => {
  logs = [];
  const service = {
    readWorkspace: async (root: string) => {
      if (root !== "/tenants/owner/workspaces/owner") throw new WorkspaceNotFoundError(root);
      return { id: "owner" };
    },
  } as unknown as ApplicationService;
  app = await buildApi({
    ownerToken,
    logger: { level: "info", stream: { write: (line: string) => logs.push(line) } },
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
  await app.inject({
    method: "PUT",
    url: "/v1/workspaces/owner/work-journal/intake",
    headers: owner,
    payload: { enabled: true },
  });
});

afterEach(async () => {
  await app.close();
});

async function agentWith(scopes: readonly AgentTokenScope[]) {
  const issued = await app.inject({
    method: "POST",
    url: "/v1/workspaces/owner/agent-tokens",
    headers: owner,
    payload: { label: "Claude Code", scopes },
  });
  expect(issued.statusCode).toBe(201);
  return { authorization: `Bearer ${issued.json().token as string}` };
}

const file = (payload: unknown, headers: Record<string, string>) =>
  app.inject({ method: "POST", url: projects, headers, payload: payload as object });

describe("project card route", () => {
  it("refuses a token without evidence:write and names the scope", async () => {
    const refused = await file(card, await agentWith(["journal"]));
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.message).toContain('"evidence:write" scope');
  });

  it("files a pending card with evidence:write, listed as a project", async () => {
    const headers = await agentWith(["journal", "evidence:write"]);
    const filed = await file(card, headers);
    expect(filed.statusCode).toBe(201);
    expect(filed.json()).toMatchObject({
      status: "pending",
      screening: "clear",
      review_url: "/#work-journal",
    });
    expect(filed.json().card_id).toMatch(/^wjn_/u);
    const listed = await app.inject({
      method: "GET",
      url: "/v1/workspaces/owner/work-journal/notes",
      headers,
    });
    expect(listed.json().notes).toMatchObject([
      { id: filed.json().card_id, status: "pending", kind: "project" },
    ]);
    expect((await file(card, headers)).json()).toMatchObject({
      status: "duplicate",
      duplicate_of: filed.json().card_id,
    });
    expect(logs.join("\n")).not.toContain("Tidewater");
  });

  it("refuses an oversized body, a code-bearing field and a contributor's email", async () => {
    const headers = await agentWith(["evidence:write"]);
    const oversized = await file({ ...card, source: "x".repeat(40_000) }, headers);
    expect(oversized.statusCode).toBe(413);
    const code = await file(
      { ...card, files: [{ path: "src/index.ts", text: "export {}" }] },
      headers,
    );
    expect(code.statusCode).toBe(422);
    expect(code.json().error.code).toBe("invalid_card");
    const email = await file(
      { ...card, highlights: [{ text: "Paired on the cache layer", source: "ana@example.test" }] },
      headers,
    );
    expect(email.statusCode).toBe(422);
    expect(email.json().error.code).toBe("contributor_identity");
  });
});
