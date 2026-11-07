import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import { createApplicationsApi, runNextStep } from "./applications.js";
import { createWorkJournalApi, createWorkspaceApiCall } from "./client.js";
import { createWorkJournalMcpServer } from "./server.js";

// A fictional application and run.
const application = {
  id: "app_fixture_0001",
  name: "Platform engineer at Fernhill",
  nameChosen: true,
  status: "drafting",
  isDefault: false,
  jobMissing: false,
  archivedAt: null,
  folderId: null,
  createdAt: "2026-11-07T09:00:00.000Z",
  updatedAt: "2026-11-07T10:00:00.000Z",
  briefs: [],
  runs: [
    {
      id: "run_old",
      state: "stopped",
      startedAt: "2026-11-06T09:00:00.000Z",
      updatedAt: "2026-11-06T10:00:00.000Z",
    },
    {
      id: "run_new",
      state: "awaiting-approval",
      startedAt: "2026-11-07T09:00:00.000Z",
      updatedAt: "2026-11-07T10:00:00.000Z",
    },
  ],
  chosenRunId: null,
  jobSourceKind: "pasted-text",
  suggestedName: null,
  exportCount: 0,
  modelProfiles: null,
  language: null,
};
const archived = {
  ...application,
  id: "app_fixture_0002",
  archivedAt: "2026-11-01T00:00:00.000Z",
  runs: [],
};

const run = {
  runId: "run_new",
  workspaceId: "owner",
  state: "awaiting-approval",
  round: 2,
  currentStep: null,
  approval: "pending",
  totalCostUsd: 0.4,
  routes: [],
  findingCount: 3,
  hasDraft: true,
  startedAt: "2026-11-07T09:00:00.000Z",
  updatedAt: "2026-11-07T10:00:00.000Z",
};

function scriptedServer(answers: Record<string, () => Response>) {
  const requests: { method: string; url: string; body?: unknown }[] = [];
  const config = {
    baseUrl: "http://127.0.0.1:8080/",
    workspaceId: "owner",
    token: async () => "dlagent_fixture",
    fetch: (async (url: string, init: RequestInit) => {
      const method = init.method ?? "GET";
      requests.push({
        method,
        url,
        ...(init.body === undefined ? {} : { body: JSON.parse(String(init.body)) }),
      });
      const answer = answers[`${method} ${url}`];
      return answer === undefined ? new Response("{}", { status: 404 }) : answer();
    }) as typeof fetch,
  };
  return { config, requests };
}

async function connect(config: ReturnType<typeof scriptedServer>["config"]) {
  const server = createWorkJournalMcpServer(
    createWorkJournalApi(config),
    createApplicationsApi(createWorkspaceApiCall(config)),
  );
  const client = new Client({ name: "test-host", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

const base = "http://127.0.0.1:8080/v1/workspaces/owner";
const json =
  (body: unknown, status = 200) =>
  () =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function parsed(answer: Awaited<ReturnType<Client["callTool"]>>) {
  const content = answer.content as { type: string; text: string }[];
  return JSON.parse(content[0]?.text ?? "{}");
}

describe("application tools", () => {
  it("are offered beside the work journal tools, read-only where they only read", async () => {
    const client = await connect(scriptedServer({}).config);
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "add_job",
      "get_application",
      "get_run_status",
      "list_applications",
      "list_work",
      "record_work",
    ]);
    for (const name of ["list_applications", "get_application", "get_run_status"]) {
      expect(tools.find((tool) => tool.name === name)?.annotations?.readOnlyHint, name).toBe(true);
    }
    expect(tools.find((tool) => tool.name === "add_job")?.description).toContain(
      "job page address is refused",
    );
    await client.close();
  });

  it("list names, status and the latest run, leaving archived ones out unless asked", async () => {
    const { config } = scriptedServer({
      [`GET ${base}/applications`]: json({ applications: [application, archived] }),
    });
    const client = await connect(config);
    const listed = parsed(await client.callTool({ name: "list_applications", arguments: {} }));
    expect(listed.applications).toEqual([
      {
        application_id: "app_fixture_0001",
        name: "Platform engineer at Fernhill",
        status: "drafting",
        archived: false,
        folder_id: null,
        updated_at: "2026-11-07T10:00:00.000Z",
        chosen_run_id: null,
        latest_run: { run_id: "run_new", state: "awaiting-approval" },
        run_count: 2,
        export_count: 0,
      },
    ]);
    const all = parsed(
      await client.callTool({ name: "list_applications", arguments: { include_archived: true } }),
    );
    expect(all.applications).toHaveLength(2);
    await client.close();
  });

  it("add a job from pasted text only, as the API's create body", async () => {
    const { config, requests } = scriptedServer({
      [`POST ${base}/applications`]: json(application, 201),
    });
    const client = await connect(config);
    const added = parsed(
      await client.callTool({
        name: "add_job",
        arguments: { name: "Platform engineer at Fernhill", job_text: "A fictional job." },
      }),
    );
    expect(added.application_id).toBe("app_fixture_0001");
    expect(requests).toEqual([
      {
        method: "POST",
        url: `${base}/applications`,
        body: { name: "Platform engineer at Fernhill", jobText: "A fictional job." },
      },
    ]);
    await client.close();
  });

  it("say where a run stands and what waits for the candidate, never the draft", async () => {
    const { config } = scriptedServer({ [`GET ${base}/runs/run_new`]: json(run) });
    const client = await connect(config);
    const status = parsed(
      await client.callTool({ name: "get_run_status", arguments: { run_id: "run_new" } }),
    );
    expect(status).toMatchObject({
      run_id: "run_new",
      state: "awaiting-approval",
      finding_count: 3,
      has_draft: true,
      last_error: null,
    });
    expect(status.next_step).toContain("candidate's review");
    expect(JSON.stringify(status)).not.toContain("totalCost");
    await client.close();
  });

  it("pass on a missing-scope refusal so the agent can tell the candidate", async () => {
    const { config } = scriptedServer({
      [`GET ${base}/applications`]: json(
        {
          error: {
            code: "forbidden",
            message:
              'This agent token lacks the "applications:read" scope; create a token with it under Coding agents in the workspace settings.',
          },
        },
        403,
      ),
    });
    const client = await connect(config);
    const refused = await client.callTool({ name: "list_applications", arguments: {} });
    expect(refused.isError).toBe(true);
    expect(parsed(refused).error).toMatchObject({ code: "forbidden", retryable: false });
    expect(parsed(refused).error.message).toContain("applications:read");
    await client.close();
  });

  it("refuse an id that is not one before calling the server", async () => {
    const { config, requests } = scriptedServer({});
    const client = await connect(config);
    const refused = await client.callTool({
      name: "get_application",
      arguments: { application_id: "../agent-tokens" },
    });
    expect(parsed(refused).error.code).toBe("invalid_id");
    expect(requests).toEqual([]);
    await client.close();
  });
});

describe("runNextStep", () => {
  it("names the candidate's step for each state", () => {
    expect(runNextStep({ state: "drafting", approval: "pending", hasDraft: false })).toContain(
      "still working",
    );
    expect(runNextStep({ state: "approved", approval: "approved", hasDraft: true })).toContain(
      "export",
    );
    expect(runNextStep({ state: "paused", approval: "pending", hasDraft: true })).toContain(
      "resume",
    );
    expect(
      runNextStep({ state: "budget-exhausted", approval: "pending", hasDraft: false }),
    ).toContain("without a draft");
  });
});
