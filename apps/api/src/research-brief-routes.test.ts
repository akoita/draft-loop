import type { ApplicationService } from "@draft-loop/application";
import type { ResearchBrief } from "@draft-loop/schemas/research-brief";
import { createMemoryResearchBriefStore } from "@draft-loop/storage/research-briefs";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { buildApi } from "./app.js";
import type { ResearchRuns } from "./research-runs.js";

const ownerToken = "owner-token-for-tests-0123456789abcdef";
const headers = { authorization: `Bearer ${ownerToken}` };
const url = "/v1/workspaces/owner/applications/app_fixture0001/research-briefs";

const service = {
  getApplication: async ({ applicationId }: { applicationId: string }) =>
    applicationId === "app_fixture0001" ? { id: applicationId, briefs: [] } : undefined,
} as unknown as ApplicationService;

// An invented employer and invented pages only.
function brief(id: string, overrides: Partial<ResearchBrief> = {}): ResearchBrief {
  return {
    id,
    workspace_id: "owner",
    application_id: "app_fixture0001",
    queries: ["Example Corp data analyst"],
    from_date: "2025-11-08",
    sources: [
      {
        id: "src_1",
        kind: "web-result",
        url: "https://example.org/news",
        title: "Example Corp opens a data team",
        excerpt: "A fictional data team.",
        published_on: "2026-10-03",
      },
      {
        id: "src_2",
        kind: "company-page",
        url: "https://example.org/about",
        title: "About",
        excerpt: "Undated page.",
      },
    ],
    findings: [{ id: "fnd_1", text: "Example Corp is hiring.", source_ids: ["src_1"] }],
    dropped: { flagged: 1, outdated: 0 },
    search_provider: "scripted",
    model: { provider: "anthropic", model: "claude-haiku-5-5" },
    cost_usd: 0.05,
    created_at: "2026-11-08T09:00:00.000Z",
    ...overrides,
  };
}

let app: FastifyInstance;

async function build(researchRuns?: ResearchRuns) {
  const briefs = createMemoryResearchBriefStore();
  await briefs.insert(brief("rbr_fixture0001"));
  await briefs.insert(brief("rbr_fixture0002", { created_at: "2026-11-08T10:00:00.000Z" }));
  await briefs.insert(brief("rbr_fixture0003", { application_id: "app_fixture0002" }));
  app = await buildApi({
    ownerToken,
    logger: false,
    application: {
      service,
      workspaceRoot: (workspaceId) => `/tenants/owner/workspaces/${workspaceId}`,
      enqueueRun: async () => undefined,
      budgetCeiling: { maxRounds: 5, maxCostUsd: 3, maxDurationMs: 1_800_000 },
      monthUsage: async () => [],
      researchBriefs: briefs,
      ...(researchRuns === undefined ? {} : { researchRuns }),
    },
  });
  return briefs;
}

afterEach(async () => {
  await app?.close();
});

describe("research brief routes", () => {
  it("lists an application's briefs newest first, without the workspace", async () => {
    await build();
    const response = await app.inject({ method: "GET", url, headers });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { briefs: Record<string, unknown>[] };
    expect(body.briefs.map((entry) => entry.id)).toEqual(["rbr_fixture0002", "rbr_fixture0001"]);
    expect(body.briefs[0]).not.toHaveProperty("workspace_id");
    expect(body.briefs[0]?.sources).toHaveLength(2);
    const missing = await app.inject({
      method: "GET",
      url: "/v1/workspaces/owner/applications/app_fixture0009/research-briefs",
      headers,
    });
    expect(missing.statusCode).toBe(404);
  });

  it("reads and deletes one brief of the application only", async () => {
    const briefs = await build();
    const one = await app.inject({ method: "GET", url: `${url}/rbr_fixture0001`, headers });
    expect(one.statusCode).toBe(200);
    expect(one.json()).toMatchObject({ id: "rbr_fixture0001", dropped: { flagged: 1 } });
    const otherApplication = await app.inject({
      method: "GET",
      url: `${url}/rbr_fixture0003`,
      headers,
    });
    expect(otherApplication.statusCode).toBe(404);
    const deleted = await app.inject({ method: "DELETE", url: `${url}/rbr_fixture0001`, headers });
    expect(deleted.statusCode).toBe(204);
    expect(await briefs.get("owner", "rbr_fixture0001")).toBeUndefined();
    const again = await app.inject({ method: "DELETE", url: `${url}/rbr_fixture0001`, headers });
    expect(again.statusCode).toBe(404);
    const wrongApplication = await app.inject({
      method: "DELETE",
      url: `${url}/rbr_fixture0003`,
      headers,
    });
    expect(wrongApplication.statusCode).toBe(404);
    expect(await briefs.get("owner", "rbr_fixture0003")).toBeDefined();
  });

  it("queues research only with the candidate's approval and answers its state", async () => {
    const queued: unknown[] = [];
    let state: Awaited<ReturnType<ResearchRuns["state"]>>;
    await build({
      queue: async (job) => {
        queued.push(job);
        const answer = state === undefined ? "queued" : "waiting";
        state = { status: "pending" };
        return answer;
      },
      state: async () => state,
    });
    const run = "/v1/workspaces/owner/applications/app_fixture0001/research";
    expect((await app.inject({ method: "GET", url: run, headers })).json()).toEqual({
      status: "none",
    });
    for (const payload of [{}, { approved: false }, { approved: "yes" }]) {
      const refused = await app.inject({ method: "POST", url: run, headers, payload });
      expect(refused.statusCode).toBe(400);
    }
    expect(queued).toEqual([]);
    const started = await app.inject({
      method: "POST",
      url: run,
      headers,
      payload: { approved: true, window_months: 6 },
    });
    expect(started.statusCode).toBe(202);
    expect(started.json()).toEqual({ status: "pending" });
    expect(queued).toEqual([
      { workspaceId: "owner", applicationId: "app_fixture0001", windowMonths: 6 },
    ]);
    state = { status: "done", outcome: "researched", briefId: "rbr_fixture0002" };
    expect((await app.inject({ method: "GET", url: run, headers })).json()).toEqual({
      status: "done",
      outcome: "researched",
      brief_id: "rbr_fixture0002",
    });
    const missing = await app.inject({
      method: "POST",
      url: "/v1/workspaces/owner/applications/app_fixture0009/research",
      headers,
      payload: { approved: true },
    });
    expect(missing.statusCode).toBe(404);
  });

  it("answers 503 when the deployment researches nothing", async () => {
    await build();
    const response = await app.inject({
      method: "POST",
      url: "/v1/workspaces/owner/applications/app_fixture0001/research",
      headers,
      payload: { approved: true },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: { code: "research_unavailable" } });
  });
});
