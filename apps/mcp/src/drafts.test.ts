import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import { createApplicationsApi } from "./applications.js";
import { createWorkJournalApi, createWorkspaceApiCall } from "./client.js";
import { createDraftsApi } from "./drafts.js";
import { createWorkJournalMcpServer } from "./server.js";

// A fictional application, its exports and its saved drafts.
const base = "http://127.0.0.1:8080/v1/workspaces/owner";
const application = {
  id: "app_fixture_0001",
  chosenRunId: null,
  runs: [
    { id: "run_old", updatedAt: "2026-11-06T10:00:00.000Z" },
    { id: "run_new", updatedAt: "2026-11-07T10:00:00.000Z" },
  ],
};
const exports = {
  exports: [
    { id: "exp_pdf", format: "pdf", createdAt: "2026-11-07T12:00:00.000Z" },
    { id: "exp_md_old", format: "markdown", createdAt: "2026-11-07T10:30:00.000Z" },
    { id: "exp_md", format: "markdown", createdAt: "2026-11-07T11:00:00.000Z" },
  ],
};
const letter = {
  id: "amd_letter01",
  kind: "cover-letter",
  created_at: "2026-11-07T13:00:00.000Z",
  based_on: "amd_letter00",
  items: [
    {
      question: "",
      text: "A fictional opening paragraph.",
      edited: true,
      citations: [{ fact_id: "fact-1", text: "A fictional career fact." }],
    },
  ],
};
const questions = {
  id: "amd_questions1",
  kind: "interview-questions",
  created_at: "2026-11-07T09:00:00.000Z",
  items: [{ question: "Why this team?", text: "A fictional talking point.", citations: [] }],
};

function scripted(answers: Record<string, () => Response>) {
  const requests: string[] = [];
  const config = {
    baseUrl: "http://127.0.0.1:8080",
    workspaceId: "owner",
    token: async () => "dlagent_fixture",
    fetch: (async (url: string, init: RequestInit) => {
      requests.push(`${init.method ?? "GET"} ${url}`);
      const reply = answers[`${init.method ?? "GET"} ${url}`];
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
    createDraftsApi(call),
  );
  const client = new Client({ name: "test-host", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

function parsed(answer: Awaited<ReturnType<Client["callTool"]>>) {
  const content = answer.content as { type: string; text: string }[];
  return JSON.parse(content[0]?.text ?? "{}");
}

describe("draft read tools", () => {
  it("are read-only and name the drafts:read scope", async () => {
    const client = await connect(scripted({}).config);
    const { tools } = await client.listTools();
    for (const name of ["get_cv", "list_materials", "get_material"]) {
      const tool = tools.find((each) => each.name === name);
      expect(tool?.annotations?.readOnlyHint, name).toBe(true);
      expect(tool?.description, name).toContain("drafts:read");
    }
    await client.close();
  });

  it("read the newest Markdown export of the latest run when none is chosen", async () => {
    const { config, requests } = scripted({
      [`GET ${base}/applications/app_fixture_0001`]: json(application),
      [`GET ${base}/runs/run_new/exports`]: json(exports),
      [`GET ${base}/runs/run_new/exports/exp_md/content`]: () =>
        new Response("# A fictional CV\n", { headers: { "content-type": "text/markdown" } }),
    });
    const client = await connect(config);
    const cv = parsed(
      await client.callTool({ name: "get_cv", arguments: { application_id: "app_fixture_0001" } }),
    );
    expect(cv).toEqual({
      application_id: "app_fixture_0001",
      run_id: "run_new",
      export_id: "exp_md",
      exported_at: "2026-11-07T11:00:00.000Z",
      markdown: "# A fictional CV\n",
    });
    expect(requests.every((request) => request.startsWith("GET "))).toBe(true);
    await client.close();
  });

  it("say the candidate exports the CV in DraftLoop when no Markdown export exists", async () => {
    const { config } = scripted({
      [`GET ${base}/applications/app_fixture_0001`]: json({
        ...application,
        chosenRunId: "run_old",
      }),
      [`GET ${base}/runs/run_old/exports`]: json({ exports: [exports.exports[0]] }),
    });
    const client = await connect(config);
    const refused = await client.callTool({
      name: "get_cv",
      arguments: { application_id: "app_fixture_0001" },
    });
    expect(refused.isError).toBe(true);
    expect(parsed(refused).error).toMatchObject({ code: "no_markdown_export", retryable: false });
    await client.close();
  });

  it("list saved drafts without their text, and read one without its citations", async () => {
    const { config } = scripted({
      [`GET ${base}/applications/app_fixture_0001/material`]: json({
        drafts: [letter, questions],
      }),
    });
    const client = await connect(config);
    const listed = parsed(
      await client.callTool({
        name: "list_materials",
        arguments: { application_id: "app_fixture_0001" },
      }),
    );
    expect(listed.materials).toEqual([
      {
        material_id: "amd_letter01",
        kind: "cover-letter",
        created_at: "2026-11-07T13:00:00.000Z",
        edited: true,
        based_on: "amd_letter00",
        item_count: 1,
      },
      {
        material_id: "amd_questions1",
        kind: "interview-questions",
        created_at: "2026-11-07T09:00:00.000Z",
        edited: false,
        based_on: null,
        item_count: 1,
      },
    ]);
    const read = parsed(
      await client.callTool({
        name: "get_material",
        arguments: { application_id: "app_fixture_0001", material_id: "amd_letter01" },
      }),
    );
    expect(read.items).toEqual([{ question: "", text: "A fictional opening paragraph." }]);
    expect(JSON.stringify(read)).not.toContain("career fact");
    const missing = await client.callTool({
      name: "get_material",
      arguments: { application_id: "app_fixture_0001", material_id: "amd_unknown" },
    });
    expect(parsed(missing).error.code).toBe("not_found");
    await client.close();
  });

  it("read a saved guide with sections and traps, without its never-say list", async () => {
    const guide = {
      id: "amd_guide01",
      kind: "interview-guide",
      created_at: "2026-11-10T09:00:00.000Z",
      items: [
        {
          section: "questions",
          question: "How do you report?",
          text: "A fictional talking point.",
          trap: "A fictional trap.",
          citations: [{ fact_id: "t", text: "career fact" }],
        },
        { section: "never-say", question: "", text: "a fictional subject", citations: [] },
      ],
    };
    const { config } = scripted({
      [`GET ${base}/applications/app_fixture_0001/material`]: json({ drafts: [guide] }),
    });
    const client = await connect(config);
    const read = parsed(
      await client.callTool({
        name: "get_material",
        arguments: { application_id: "app_fixture_0001", material_id: "amd_guide01" },
      }),
    );
    expect(read.item_count).toBe(1);
    expect(read.items).toEqual([
      {
        section: "questions",
        question: "How do you report?",
        text: "A fictional talking point.",
        trap: "A fictional trap.",
      },
    ]);
    expect(JSON.stringify(read)).not.toContain("a fictional subject");
    await client.close();
  });

  it("pass on a missing drafts:read refusal", async () => {
    const { config } = scripted({
      [`GET ${base}/applications/app_fixture_0001/material`]: json(
        {
          error: {
            code: "forbidden",
            message:
              'This agent token lacks the "drafts:read" scope (Read CVs and drafts on the token form); create a token with it in Workspace settings > Agents.',
          },
        },
        403,
      ),
    });
    const client = await connect(config);
    const refused = await client.callTool({
      name: "list_materials",
      arguments: { application_id: "app_fixture_0001" },
    });
    expect(parsed(refused).error.message).toContain("drafts:read");
    await client.close();
  });
});
