import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import { createApplicationsApi } from "./applications.js";
import { createWorkJournalApi, createWorkspaceApiCall } from "./client.js";
import { createRunsApi } from "./runs.js";
import { createWorkJournalMcpServer } from "./server.js";

// A fictional application with one reviewed brief among others.
const base = "http://127.0.0.1:8080/v1/workspaces/owner";
const application = {
  id: "app_fixture_0001",
  briefs: [
    { briefId: "brief_old", latestVersion: 1, status: "reviewed", createdAt: "2026-11-01T10:00Z" },
    { briefId: "brief_new", latestVersion: 3, status: "reviewed", createdAt: "2026-11-05T10:00Z" },
    { briefId: "brief_draft", latestVersion: 1, status: "draft", createdAt: "2026-11-08T10:00Z" },
  ],
};
const estimate = {
  credits: 40,
  estimateVersion: 2,
  basis: { base: 10, premium: false, highReasoning: false, roundBlocks: 3 },
  maxRounds: 3,
  authorTier: "standard",
  criticTier: "standard",
  agentSpend: { monthlyCapUsd: 5, spentThisMonthUsd: 4, remainingUsd: 1, runReservesUsd: 2 },
};

interface Request {
  readonly line: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

function scripted(answers: Record<string, () => Response>) {
  const requests: Request[] = [];
  const config = {
    baseUrl: "http://127.0.0.1:8080",
    workspaceId: "owner",
    token: async () => "dlagent_fixture",
    fetch: (async (url: string, init: RequestInit) => {
      const line = `${init.method ?? "GET"} ${url}`;
      requests.push({
        line,
        headers: init.headers as Record<string, string>,
        body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
      });
      const reply = answers[line];
      return reply === undefined ? new Response("{}", { status: 404 }) : reply();
    }) as typeof fetch,
  };
  return { config, requests };
}

const json =
  (body: unknown, status = 200) =>
  () =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function connect(config: ReturnType<typeof scripted>["config"]) {
  const call = createWorkspaceApiCall(config);
  const server = createWorkJournalMcpServer(
    createWorkJournalApi(config),
    createApplicationsApi(call),
    undefined,
    createRunsApi(call),
  );
  const client = new Client({ name: "test-host", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

function parsed(result: Awaited<ReturnType<Client["callTool"]>>) {
  const [first] = result.content as { type: string; text: string }[];
  return JSON.parse(first?.text ?? "{}");
}

describe("run tools", () => {
  it("price a run with what remains of the token's monthly cap", async () => {
    const { config, requests } = scripted({
      [`GET ${base}/runs/estimate?applicationId=app_fixture_0001`]: json(estimate),
    });
    const client = await connect(config);
    const priced = await client.callTool({
      name: "estimate_run",
      arguments: { application_id: "app_fixture_0001" },
    });
    expect(priced.structuredContent).toEqual({
      credits: 40,
      max_rounds: 3,
      author_tier: "standard",
      critic_tier: "standard",
      spend: {
        monthly_cap_usd: 5,
        spent_this_month_usd: 4,
        remaining_usd: 1,
        run_reserves_usd: 2,
      },
      within_cap: false,
    });
    expect(requests).toHaveLength(1);
    const { tools } = await client.listTools();
    expect(tools.find((tool) => tool.name === "estimate_run")?.annotations?.readOnlyHint).toBe(
      true,
    );
    expect(tools.find((tool) => tool.name === "start_cv_run")?.annotations?.readOnlyHint).toBe(
      false,
    );
    await client.close();
  });

  it("start a run on the newest reviewed brief with an idempotency key, and nothing else", async () => {
    const { config, requests } = scripted({
      [`GET ${base}/applications/app_fixture_0001`]: json(application),
      [`POST ${base}/runs`]: json({ runId: "run_fixture1", state: "drafting" }, 201),
    });
    const client = await connect(config);
    const started = await client.callTool({
      name: "start_cv_run",
      arguments: { application_id: "app_fixture_0001" },
    });
    expect(started.structuredContent).toMatchObject({
      application_id: "app_fixture_0001",
      run_id: "run_fixture1",
      state: "drafting",
      brief_id: "brief_new",
      brief_version: 3,
    });
    const post = requests.find((request) => request.line === `POST ${base}/runs`);
    expect(post?.body).toEqual({
      applicationId: "app_fixture_0001",
      opportunityBrief: { briefId: "brief_new", version: 3 },
    });
    expect(post?.headers["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/u);
    await client.close();
  });

  it("start nothing until the candidate reviewed the job's requirements", async () => {
    const { config, requests } = scripted({
      [`GET ${base}/applications/app_fixture_0001`]: json({
        ...application,
        briefs: [application.briefs[2]],
      }),
    });
    const client = await connect(config);
    const refused = await client.callTool({
      name: "start_cv_run",
      arguments: { application_id: "app_fixture_0001" },
    });
    expect(parsed(refused).error).toMatchObject({ code: "brief_not_reviewed", retryable: false });
    expect(requests.map((request) => request.line)).toEqual([
      `GET ${base}/applications/app_fixture_0001`,
    ]);
    await client.close();
  });

  it("say a spent cap waits for next month instead of retrying", async () => {
    const { config } = scripted({
      [`GET ${base}/applications/app_fixture_0001`]: json(application),
      [`POST ${base}/runs`]: json(
        {
          error: {
            code: "agent_spend_cap_reached",
            message: "This agent token has reserved $4.00 of its $5.00 monthly cap.",
          },
        },
        429,
      ),
    });
    const client = await connect(config);
    const refused = await client.callTool({
      name: "start_cv_run",
      arguments: { application_id: "app_fixture_0001" },
    });
    expect(refused.isError).toBe(true);
    expect(parsed(refused).error).toMatchObject({
      code: "agent_spend_cap_reached",
      retryable: false,
    });
    await client.close();
  });
});
