import { type ApplicationService, WorkspaceNotFoundError } from "@draft-loop/application";
import { createWorkJournalService } from "@draft-loop/application/work-journal";
import { createMemoryAgentTokenStore } from "@draft-loop/storage/agent-tokens";
import { createMemoryWorkJournalNoteStore } from "@draft-loop/storage/work-journal-notes";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApi } from "./app.js";

const ownerToken = "owner-token-for-tests-0123456789abcdef";
const owner = { authorization: `Bearer ${ownerToken}` };

let app: FastifyInstance;

beforeEach(async () => {
  const service = {
    readWorkspace: async (root: string) => {
      if (root !== "/tenants/owner/workspaces/owner") throw new WorkspaceNotFoundError(root);
      return { id: "owner" };
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
      // Agent tokens are issued where the work journal is wired.
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

async function agentWith(scopes?: readonly string[]) {
  const issued = await app.inject({
    method: "POST",
    url: "/v1/workspaces/owner/agent-tokens",
    headers: owner,
    payload: { label: "Claude Code", ...(scopes === undefined ? {} : { scopes }) },
  });
  expect(issued.statusCode).toBe(201);
  return { authorization: `Bearer ${issued.json().token as string}` };
}

describe("the user guide routes (#2881)", () => {
  it("return the whole guide in English by default", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/help", headers: owner });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.language).toBe("en");
    expect(body.query).toBeNull();
    expect(body.sections[0]).toMatchObject({ id: "evidence", title: "Add your career evidence" });
    expect(body.sections.length).toBeGreaterThanOrEqual(10);
  });

  it("search in French, best match first", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/help?language=fr&q=cr%C3%A9dits",
      headers: owner,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().query).toBe("crédits");
    expect(response.json().sections[0]).toMatchObject({
      id: "credits",
      title: "Offres et crédits",
    });
  });

  it("refuse a caller without a credential and an unknown language", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/help" })).statusCode).toBe(401);
    const german = await app.inject({ method: "GET", url: "/v1/help?language=de", headers: owner });
    expect(german.statusCode).toBe(400);
  });

  it("let an agent token read it through a record's address, with the default scope", async () => {
    const agent = await agentWith();
    const response = await app.inject({
      method: "GET",
      url: "/v1/workspaces/owner/help?q=export",
      headers: agent,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().sections[0].id).toBe("review");
    // The person's own route stays closed to the token.
    expect((await app.inject({ method: "GET", url: "/v1/help", headers: agent })).statusCode).toBe(
      403,
    );
  });
});
