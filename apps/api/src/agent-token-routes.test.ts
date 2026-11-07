import { type ApplicationService, WorkspaceNotFoundError } from "@draft-loop/application";
import { createWorkJournalService } from "@draft-loop/application/work-journal";
import {
  type AgentTokenStore,
  createMemoryAgentTokenStore,
  maximumActiveAgentTokens,
} from "@draft-loop/storage/agent-tokens";
import { createMemoryWorkJournalNoteStore } from "@draft-loop/storage/work-journal-notes";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { agentTokenHash } from "./agent-token-auth.js";
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
let store: AgentTokenStore;
let logs: string[];

beforeEach(async () => {
  store = createMemoryAgentTokenStore();
  logs = [];
  app = await buildApi({
    ownerToken,
    logger: { level: "info", stream: { write: (line: string) => logs.push(line) } },
    agentTokens: store,
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
  // The screen offers a coding agent's setup only where agent tokens are issued (#2427).
  expect(enabled.json()).toMatchObject({ enabled: true, agent_tokens: true });
});

afterEach(async () => {
  await app.close();
});

async function issue(
  label = "Claude Code",
  expiresInDays?: number,
): Promise<{ id: string; token: string; created_at: string; expires_at: string }> {
  const issued = await app.inject({
    method: "POST",
    url: tokens,
    headers: owner,
    payload: { label, ...(expiresInDays === undefined ? {} : { expires_in_days: expiresInDays }) },
  });
  expect(issued.statusCode).toBe(201);
  return issued.json();
}

describe("agent tokens", () => {
  it("are issued once with their secret and listed without it", async () => {
    const issued = await issue();
    expect(issued.token).toMatch(/^dlagent_[A-Za-z0-9_-]{43}$/u);
    expect(issued.id).toMatch(/^dlat_/u);
    // 90 days by default.
    expect(Date.parse(issued.expires_at) - Date.parse(issued.created_at)).toBe(90 * 86_400_000);

    const listed = await app.inject({ method: "GET", url: tokens, headers: owner });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual({
      tokens: [
        {
          id: issued.id,
          label: "Claude Code",
          created_at: issued.created_at,
          expires_at: issued.expires_at,
          active: true,
        },
      ],
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
        expect.objectContaining({ id: first.id, revoked_at: expect.any(String), active: false }),
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

  it("live for the days asked, at most a year, and are refused once expired", async () => {
    const week = await issue("Short", 7);
    expect(Date.parse(week.expires_at) - Date.parse(week.created_at)).toBe(7 * 86_400_000);
    for (const days of [0, 366]) {
      const refused = await app.inject({
        method: "POST",
        url: tokens,
        headers: owner,
        payload: { label: "Too long", expires_in_days: days },
      });
      expect(refused.statusCode, `${days} days`).toBe(400);
    }

    // A token issued long ago whose expiry has passed, as the store would hold it.
    const secret = `dlagent_${"e".repeat(43)}`;
    await store.insert({
      id: "dlat_expired0001",
      workspaceId: "owner",
      label: "Expired",
      createdAt: "2025-01-01T00:00:00.000Z",
      expiresAt: "2025-02-01T00:00:00.000Z",
      secretHash: agentTokenHash(secret),
    });
    const expired = await app.inject({
      method: "GET",
      url: notes,
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(expired.statusCode).toBe(401);
    expect(logs.join("\n")).toContain("expired agent token");
    const listed = (await app.inject({ method: "GET", url: tokens, headers: owner })).json();
    expect(listed.tokens).toContainEqual(
      expect.objectContaining({ id: "dlat_expired0001", active: false }),
    );
  });

  it(`cap a workspace at ${maximumActiveAgentTokens} active tokens; a revoked one frees a place`, async () => {
    const issued = [];
    for (let index = 0; index < maximumActiveAgentTokens; index += 1) {
      issued.push(await issue(`Agent ${index}`));
    }
    const over = await app.inject({
      method: "POST",
      url: tokens,
      headers: owner,
      payload: { label: "One too many" },
    });
    expect(over.statusCode).toBe(409);
    expect(over.json().error.code).toBe("agent_token_limit");
    await app.inject({ method: "DELETE", url: `${tokens}/${issued[0]?.id}`, headers: owner });
    await issue("Replacement");
  });

  it("log each accepted request with the token's id, never its secret", async () => {
    const { id, token } = await issue();
    const listed = await app.inject({
      method: "GET",
      url: notes,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(listed.statusCode).toBe(200);
    const accepted = logs.filter((line) => line.includes("agent token accepted"));
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toContain(id);
    expect(logs.join("\n")).not.toContain(token);
  });
});

describe("notes filed with agent tokens", () => {
  it("name the token for the owner, who can list a token's notes after revoking it", async () => {
    const first = await issue("Claude Code");
    const second = await issue("Codex");
    const recorded = await app.inject({
      method: "POST",
      url: notes,
      headers: { authorization: `Bearer ${first.token}` },
      payload: note,
    });
    expect(recorded.statusCode).toBe(201);
    await app.inject({
      method: "POST",
      url: notes,
      headers: { authorization: `Bearer ${second.token}` },
      payload: { ...note, title: "Search for the Fernhill booking site", links: [] },
    });
    await app.inject({ method: "DELETE", url: `${tokens}/${first.id}`, headers: owner });

    const full = await app.inject({
      method: "GET",
      url: `${notes}?fields=summary&agent_token_id=${first.id}`,
      headers: owner,
    });
    expect(full.statusCode).toBe(200);
    expect(full.json().full).toHaveLength(1);
    expect(full.json().full[0]).toMatchObject({
      agent_token_id: first.id,
      content: { title: note.title },
    });

    const titles = await app.inject({
      method: "GET",
      url: notes,
      headers: { authorization: `Bearer ${second.token}` },
    });
    expect(titles.statusCode).toBe(200);
    expect(titles.body).not.toContain("dlat_");
    expect(logs.join("\n")).toContain(`"agentTokenId":"${first.id}"`);
  });
});
