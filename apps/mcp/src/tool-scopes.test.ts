import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import { createDraftLoopMcpServer } from "./remote.js";
import { missingToolScope, toolScopes } from "./tool-scopes.js";

async function everyTool() {
  const server = createDraftLoopMcpServer(
    { baseUrl: "http://api.example.test", workspaceId: "ws-1", token: async () => "t" },
    { operator: true },
  );
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "scopes-test", version: "1.0.0" });
  await client.connect(clientSide);
  const { tools } = await client.listTools();
  await client.close();
  return tools;
}

describe("toolScopes", () => {
  it("names every tool, with the scope its description says it needs", async () => {
    const tools = await everyTool();

    expect(Object.keys(toolScopes).sort()).toEqual(tools.map((tool) => tool.name).sort());
    for (const tool of tools) {
      const stated = /Needs the ([\w:]+) scope/u.exec(tool.description ?? "")?.[1];
      if (stated !== undefined) expect(toolScopes[tool.name], tool.name).toBe(stated);
    }
  });
});

describe("missingToolScope", () => {
  const call = (name: string) => ({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name, arguments: {} },
  });

  it("names the first scope a called tool needs and the grant lacks", () => {
    expect(missingToolScope(call("get_cv"), ["draftloop:journal"])).toBe("draftloop:drafts:read");
    expect(missingToolScope([call("list_work"), call("add_job")], ["draftloop:journal"])).toBe(
      "draftloop:jobs:write",
    );
  });

  it("names none when the grant covers the call, or for other messages and unknown tools", () => {
    expect(missingToolScope(call("get_cv"), ["draftloop:drafts:read"])).toBeUndefined();
    expect(missingToolScope({ jsonrpc: "2.0", id: 1, method: "tools/list" }, [])).toBeUndefined();
    expect(missingToolScope(call("list_feedback"), [])).toBeUndefined();
    expect(missingToolScope(call("toString"), [])).toBeUndefined();
    expect(missingToolScope(null, [])).toBeUndefined();
  });
});
