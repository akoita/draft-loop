import { type ApplicationService, WorkspaceNotFoundError } from "@draft-loop/application";
import { createWorkJournalService } from "@draft-loop/application/work-journal";
import { createMemoryAgentTokenStore } from "@draft-loop/storage/agent-tokens";
import { createMemoryWorkJournalNoteStore } from "@draft-loop/storage/work-journal-notes";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApi } from "./app.js";

const ownerToken = "owner-token-for-tests-0123456789abcdef";
const owner = { authorization: `Bearer ${ownerToken}` };
const tokens = "/v1/workspaces/owner/agent-tokens";
const notes = "/v1/workspaces/owner/work-journal/notes";

// Fictional project and links only.
const note = {
  title: "Card payments for the Fernhill booking site",
  summary:
    "Added card payments to the booking flow with a hosted checkout page, webhook handling for paid and refunded bookings, and retries for failed deliveries.",
  period: { start: "2026-10-12", end: "2026-10-30" },
  project: { name: "Fernhill bookings", visibility: "private" },
  technologies: ["TypeScript", "Stripe"],
  category: "payments",
  candidate_role: ["implemented"],
  links: [],
};

const service = {
  readWorkspace: async (root: string) => {
    if (root !== "/tenants/owner/workspaces/owner") throw new WorkspaceNotFoundError(root);
    return { id: "owner" };
  },
} as unknown as ApplicationService;

let app: FastifyInstance;

beforeEach(async () => {
  app = await buildApi({
    ownerToken,
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
  const enabled = await app.inject({
    method: "PUT",
    url: "/v1/workspaces/owner/work-journal/intake",
    headers: owner,
    payload: { enabled: true },
  });
  expect(enabled.statusCode).toBe(200);
});

afterEach(async () => {
  await app.close();
});

async function issue(label = "Claude Code"): Promise<{ id: string; token: string }> {
  const issued = await app.inject({
    method: "POST",
    url: tokens,
    headers: owner,
    payload: { label },
  });
  expect(issued.statusCode).toBe(201);
  return issued.json();
}

describe("agent tokens", () => {
  it("are issued once with their secret and listed without it", async () => {
    const issued = await issue();
    expect(issued.token).toMatch(/^dlagent_[A-Za-z0-9_-]{43}$/u);
    expect(issued.id).toMatch(/^dlat_/u);

    const listed = await app.inject({ method: "GET", url: tokens, headers: owner });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual({
      tokens: [{ id: issued.id, label: "Claude Code", created_at: expect.any(String) }],
    });
    expect(listed.body).not.toContain(issued.token);

    const missing = await app.inject({
      method: "POST",
      url: "/v1/workspaces/other/agent-tokens",
      headers: owner,
      payload: { label: "Elsewhere" },
    });
    expect(missing.statusCode).toBe(404);
  });

  it("record and list titles on their own workspace's work journal", async () => {
    const { token } = await issue();
    const agent = { authorization: `Bearer ${token}` };

    const recorded = await app.inject({
      method: "POST",
      url: notes,
      headers: agent,
      payload: note,
    });
    expect(recorded.statusCode).toBe(201);
    expect(recorded.json()).toMatchObject({ review_url: "/#work-journal" });

    const listed = await app.inject({ method: "GET", url: notes, headers: agent });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().notes).toHaveLength(1);
  });

  it("are refused on every other route, including whole notes and other workspaces", async () => {
    const { token } = await issue();
    const agent = { authorization: `Bearer ${token}` };
    await app.ready();
    const document = app.swagger() as {
      paths: Record<string, Record<string, { security?: unknown[] }>>;
    };
    const allowed = new Set([`post ${notes}`, `get ${notes}`]);
    let checked = 0;
    for (const [template, operations] of Object.entries(document.paths)) {
      const url = template.replace(/\{[^}]+\}/gu, (name) =>
        name === "{workspaceId}" ? "owner" : "wjn_fixture0001",
      );
      for (const [method, operation] of Object.entries(operations)) {
        if (operation.security?.length === 0) continue; // public: health, auth config
        if (allowed.has(`${method} ${url}`)) continue;
        const answer = await app.inject({
          method: method.toUpperCase() as "GET",
          url,
          headers: agent,
          ...(method === "get" || method === "delete" ? {} : { payload: {} }),
        });
        expect([401, 403], `${method} ${template}`).toContain(answer.statusCode);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(20);

    const whole = await app.inject({
      method: "GET",
      url: `${notes}?fields=summary`,
      headers: agent,
    });
    expect(whole.statusCode).toBe(403);
    const elsewhere = await app.inject({
      method: "POST",
      url: "/v1/workspaces/other/work-journal/notes",
      headers: agent,
      payload: note,
    });
    expect(elsewhere.statusCode).toBe(403);
  });

  it("are refused once revoked, while the others keep working", async () => {
    const first = await issue("Claude Code");
    const second = await issue("Codex");

    const revoked = await app.inject({
      method: "DELETE",
      url: `${tokens}/${first.id}`,
      headers: owner,
    });
    expect(revoked.statusCode).toBe(204);
    const again = await app.inject({
      method: "DELETE",
      url: `${tokens}/${first.id}`,
      headers: owner,
    });
    expect(again.statusCode).toBe(404);

    const refused = await app.inject({
      method: "GET",
      url: notes,
      headers: { authorization: `Bearer ${first.token}` },
    });
    expect(refused.statusCode).toBe(401);
    const working = await app.inject({
      method: "GET",
      url: notes,
      headers: { authorization: `Bearer ${second.token}` },
    });
    expect(working.statusCode).toBe(200);

    const listed = await app.inject({ method: "GET", url: tokens, headers: owner });
    const listedTokens = listed.json().tokens;
    expect(listedTokens).toHaveLength(2);
    expect(listedTokens).toEqual(
      expect.arrayContaining([
        expect.not.objectContaining({ id: first.id }),
        expect.objectContaining({ id: first.id, revoked_at: expect.any(String) }),
      ]),
    );
  });

  it("refuse an unknown agent token", async () => {
    const unknown = await app.inject({
      method: "GET",
      url: notes,
      headers: { authorization: `Bearer dlagent_${"x".repeat(43)}` },
    });
    expect(unknown.statusCode).toBe(401);
  });
});
