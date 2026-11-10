import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import { createWorkJournalApi, createWorkspaceApiCall } from "./client.js";
import { createMaterialApi } from "./material.js";
import { createWorkJournalMcpServer } from "./server.js";

// A fictional saved draft, as the API answers it.
const base = "http://127.0.0.1:8080/v1/workspaces/owner";
const letter = {
  id: "amd_letter01",
  created_at: "2026-11-09T10:00:00.000Z",
  kind: "cover-letter",
  items: [
    {
      question: "",
      text: "A fictional opening paragraph.",
      citations: [{ fact_id: "fact-1", text: "A fictional career fact." }],
    },
  ],
  model: { provider: "anthropic", model: "claude-sonnet-5-5" },
};

function scripted(reply: () => Response) {
  const requests: { line: string; body: unknown }[] = [];
  const config = {
    baseUrl: "http://127.0.0.1:8080",
    workspaceId: "owner",
    token: async () => "dlagent_fixture",
    fetch: (async (url: string, init: RequestInit) => {
      requests.push({
        line: `${init.method ?? "GET"} ${url}`,
        body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
      });
      return reply();
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
    undefined,
    undefined,
    undefined,
    createMaterialApi(call),
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

describe("drafting tools", () => {
  it("draft a cover letter with the candidate's guidance, returned without citations", async () => {
    const { config, requests } = scripted(json(letter));
    const client = await connect(config);
    const drafted = await client.callTool({
      name: "draft_cover_letter",
      arguments: { application_id: "app_fixture_0001", guidance: { tone: "warm" } },
    });
    expect(drafted.structuredContent).toEqual({
      application_id: "app_fixture_0001",
      material_id: "amd_letter01",
      kind: "cover-letter",
      created_at: "2026-11-09T10:00:00.000Z",
      items: [{ question: "", text: "A fictional opening paragraph." }],
      next_step: "The draft is saved in DraftLoop, where the candidate reviews and edits it.",
    });
    expect(requests).toEqual([
      {
        line: `POST ${base}/applications/app_fixture_0001/material`,
        body: { kind: "cover-letter", guidance: { tone: "warm" } },
      },
    ]);
    await client.close();
  });

  it("draft interview questions, never naming a model", async () => {
    const { config, requests } = scripted(
      json({ ...letter, kind: "interview-questions", items: [] }),
    );
    const client = await connect(config);
    await client.callTool({
      name: "draft_interview_prep",
      arguments: { application_id: "app_fixture_0001" },
    });
    expect(requests[0]?.body).toEqual({ kind: "interview-questions" });
    const { tools } = await client.listTools();
    for (const name of ["draft_cover_letter", "draft_interview_prep"]) {
      expect(tools.find((tool) => tool.name === name)?.annotations?.readOnlyHint, name).toBe(false);
    }
    await client.close();
  });

  it("say a spent cap waits for next month instead of retrying", async () => {
    const { config } = scripted(
      json(
        { error: { code: "agent_spend_cap_reached", message: "The monthly cap is spent." } },
        429,
      ),
    );
    const client = await connect(config);
    const refused = await client.callTool({
      name: "draft_cover_letter",
      arguments: { application_id: "app_fixture_0001" },
    });
    expect(parsed(refused).error).toMatchObject({
      code: "agent_spend_cap_reached",
      retryable: false,
    });
    await client.close();
  });
});
