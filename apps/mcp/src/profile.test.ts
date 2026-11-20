import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import { createWorkJournalApi, createWorkspaceApiCall } from "./client.js";
import { createProfileApi, suggestProfileUpdateDescription } from "./profile.js";
import { createWorkJournalMcpServer } from "./server.js";

// Fictional facts only.
function scripted(status: number, body: unknown) {
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
    undefined,
    undefined,
    undefined,
    createProfileApi(call),
  );
  const client = new Client({ name: "test-host", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe("career profile tools (#3072)", () => {
  it("reads the reviewed profile", async () => {
    const answer = {
      profileId: "career",
      version: 3,
      facts: [
        {
          id: "fact-team",
          category: "achievement",
          field: "team size",
          value: "Led a team of 5",
          usage: "cv",
        },
      ],
      withheld: 1,
    };
    const { config, requests } = scripted(200, answer);
    const client = await connect(config);
    const read = await client.callTool({ name: "get_profile", arguments: {} });
    expect(read.isError).not.toBe(true);
    expect(read.structuredContent).toEqual(answer);
    expect(requests[0]?.line).toBe("GET http://127.0.0.1:8080/v1/workspaces/owner/agent-profile");
    await client.close();
  });

  it("files a suggestion and lists what it filed", async () => {
    const { config, requests } = scripted(201, {
      suggestionId: "fsg_fixture0001",
      status: "pending",
      message: "Filed.",
    });
    const client = await connect(config);
    const suggestion = {
      factId: "fact-team",
      change: { kind: "correct", value: "Led a team of 8" },
      quote: "I led eight engineers.",
      speaker: "candidate",
    };
    const filed = await client.callTool({ name: "suggest_profile_update", arguments: suggestion });
    expect(filed.structuredContent).toMatchObject({ status: "pending" });
    expect(requests[0]).toEqual({
      line: "POST http://127.0.0.1:8080/v1/workspaces/owner/agent-profile/suggestions",
      body: suggestion,
    });
    await client.callTool({ name: "list_profile_suggestions", arguments: { limit: 5 } });
    expect(requests[1]?.line).toBe(
      "GET http://127.0.0.1:8080/v1/workspaces/owner/agent-profile/suggestions?limit=5",
    );
    await client.close();
  });

  it("refuses a malformed change before calling the API and relays a missing scope", async () => {
    const malformed = scripted(201, {});
    const client = await connect(malformed.config);
    const refused = await client.callTool({
      name: "suggest_profile_update",
      arguments: { change: { kind: "rewrite" }, quote: "x", speaker: "agent" },
    });
    expect(refused.isError).toBe(true);
    expect(malformed.requests).toEqual([]);
    await client.close();

    const scope = scripted(403, {
      error: { code: "forbidden", message: 'This agent token lacks the "profile:suggest" scope.' },
    });
    const scoped = await connect(scope.config);
    const forbidden = await scoped.callTool({ name: "get_profile", arguments: {} });
    expect(forbidden.isError).toBe(true);
    expect(JSON.stringify(forbidden.content)).toContain("profile:suggest");
    await scoped.close();
  });

  it("says that the candidate decides and that nothing is invented", async () => {
    const client = await connect(scripted(200, {}).config);
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["get_profile", "suggest_profile_update", "list_profile_suggestions"]),
    );
    expect(suggestProfileUpdateDescription).toContain("you never decide");
    expect(suggestProfileUpdateDescription).toContain("Never invent a fact");
    await client.close();
  });
});
