import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import { createWorkJournalApi, createWorkspaceApiCall } from "./client.js";
import { addProjectDescription, createProjectsApi, projectGuideText } from "./projects.js";
import { createWorkJournalMcpServer } from "./server.js";

// A fictional repository only.
const card = {
  name: "Tidewater",
  purpose: "A command-line tool that plans tide-safe kayak trips",
  summary:
    "Tidewater reads public tide tables and proposes launch windows for a kayak route, with offline caching.",
  role: "sole-author",
  visibility: "public",
  stack: ["TypeScript"],
  contribution: {
    own_commits: 40,
    total_commits: 41,
    first_commit: "2026-01-02",
    last_commit: "2026-10-30",
    other_contributors: 1,
  },
};

function scripted(status: number, body: unknown) {
  const requests: { line: string; key: string | undefined; body: unknown }[] = [];
  const config = {
    baseUrl: "http://127.0.0.1:8080",
    workspaceId: "owner",
    token: async () => "dlagent_fixture",
    fetch: (async (url: string, init: RequestInit) => {
      const headers = (init.headers ?? {}) as Record<string, string>;
      requests.push({
        line: `${init.method ?? "GET"} ${url}`,
        key: headers["idempotency-key"],
        body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
      });
      return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch,
  };
  return { config, requests };
}

async function connect(config: ReturnType<typeof scripted>["config"]) {
  const call = createWorkspaceApiCall(config);
  const server = createWorkJournalMcpServer(
    createWorkJournalApi(config),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    createProjectsApi(call),
  );
  const client = new Client({ name: "test-host", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe("add_project (#2895)", () => {
  it("files the card with a stable idempotency key and returns the pending card", async () => {
    const answer = {
      card_id: "wjn_card000001",
      status: "pending",
      possible_duplicate_of: [],
      screening: "clear",
      review_url: "/#work-journal",
      message: "Recorded; the candidate reviews it in DraftLoop before it becomes evidence.",
    };
    const { config, requests } = scripted(201, answer);
    const client = await connect(config);
    const filed = await client.callTool({ name: "add_project", arguments: card });
    await client.callTool({ name: "add_project", arguments: card });
    expect(filed.isError).not.toBe(true);
    expect(filed.structuredContent).toEqual(answer);
    expect(requests[0]).toMatchObject({
      line: "POST http://127.0.0.1:8080/v1/workspaces/owner/work-journal/projects",
      body: { name: "Tidewater", role: "sole-author" },
    });
    expect(requests[0]?.key).toMatch(/^mcp-card-[0-9a-f]{40}$/u);
    expect(requests[1]?.key).toBe(requests[0]?.key);
    await client.close();
  });

  it("refuses a card with extra fields such as file contents before calling the API", async () => {
    const { config, requests } = scripted(201, {});
    const client = await connect(config);
    const refused = await client.callTool({
      name: "add_project",
      arguments: { ...card, files: [{ path: "src/index.ts", text: "export {}" }] },
    });
    expect(refused.isError).toBe(true);
    expect(requests).toEqual([]);
    await client.close();
  });

  it("relays a missing scope as a refusal the agent can repeat", async () => {
    const { config } = scripted(403, {
      error: { code: "forbidden", message: 'This agent token lacks the "evidence:write" scope.' },
    });
    const client = await connect(config);
    const refused = await client.callTool({ name: "add_project", arguments: card });
    expect(refused.isError).toBe(true);
    expect(JSON.stringify(refused.content)).toContain("evidence:write");
    await client.close();
  });

  it("states the rules in the tool and serves the guide", async () => {
    const client = await connect(scripted(201, {}).config);
    const { tools } = await client.listTools();
    const tool = tools.find((each) => each.name === "add_project");
    expect(tool?.description).toBe(addProjectDescription);
    for (const rule of ["Never send source code", "never estimate", "Never name or email"]) {
      expect(addProjectDescription).toContain(rule);
    }
    const guide = await client.readResource({ uri: "draftloop://projects/guide" });
    expect(guide.contents[0]).toMatchObject({ text: projectGuideText });
    await client.close();
  });
});
