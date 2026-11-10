import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";

import {
  maximumRemoteBodyBytes,
  remoteMcpPath,
  remoteOptionsFromEnvironment,
  serveRemoteMcp,
} from "./remote.js";

interface ApiCall {
  readonly url: string;
  readonly authorization: string | null;
}

let server: Server | undefined;

afterEach(async () => {
  await new Promise((resolve) =>
    server === undefined ? resolve(undefined) : server.close(resolve),
  );
  server = undefined;
});

/** A remote server over a scripted API that lists no applications. */
async function remote(calls: ApiCall[] = []): Promise<string> {
  server = await serveRemoteMcp({
    baseUrl: "http://api.example.test",
    workspaceId: "ws-1",
    port: 0,
    host: "127.0.0.1",
    fetch: async (input, init) => {
      calls.push({
        url: String(input),
        authorization: new Headers(init?.headers).get("authorization"),
      });
      return Response.json({ applications: [] });
    },
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function connect(origin: string, token: string): Promise<Client> {
  const client = new Client({ name: "remote-test", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${origin}${remoteMcpPath}`), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }),
  );
  return client;
}

const initialize = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });

describe("the remote MCP server", () => {
  it("serves every tool with a title and explicit hints", async () => {
    const client = await connect(await remote(), "credential-a");

    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["record_work", "list_applications", "get_cv", "start_cv_run"]),
    );
    for (const tool of tools) {
      expect(tool.title ?? "", tool.name).not.toBe("");
      expect(typeof tool.annotations?.readOnlyHint, tool.name).toBe("boolean");
      expect(typeof tool.annotations?.openWorldHint, tool.name).toBe("boolean");
      if (tool.annotations?.readOnlyHint === false) {
        expect(typeof tool.annotations.destructiveHint, tool.name).toBe("boolean");
      }
    }
    await client.close();
  });

  it("forwards each caller's own credential to the API, in the configured workspace", async () => {
    const calls: ApiCall[] = [];
    const origin = await remote(calls);
    const first = await connect(origin, "credential-a");
    const second = await connect(origin, "credential-b");

    await first.callTool({ name: "list_applications", arguments: {} });
    await second.callTool({ name: "list_applications", arguments: {} });

    expect(calls.map((call) => call.authorization)).toEqual([
      "Bearer credential-a",
      "Bearer credential-b",
    ]);
    expect(calls[0]?.url).toContain("http://api.example.test/v1/workspaces/ws-1/applications");
    await first.close();
    await second.close();
  });

  it("answers 401 with a Bearer challenge when no credential is sent, before any API call", async () => {
    const calls: ApiCall[] = [];
    const origin = await remote(calls);

    const response = await fetch(`${origin}${remoteMcpPath}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: initialize,
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
    expect(calls).toEqual([]);
  });

  it("refuses other methods, other paths, oversized and malformed bodies", async () => {
    const origin = await remote();
    const headers = { authorization: "Bearer credential-a", "content-type": "application/json" };

    expect((await fetch(`${origin}${remoteMcpPath}`, { headers })).status).toBe(405);
    expect((await fetch(`${origin}/v1/workspaces`, { headers })).status).toBe(404);
    expect(
      (await fetch(`${origin}${remoteMcpPath}`, { method: "POST", headers, body: "{" })).status,
    ).toBe(400);
    expect(
      (
        await fetch(`${origin}${remoteMcpPath}`, {
          method: "POST",
          headers,
          body: JSON.stringify({ padding: "x".repeat(maximumRemoteBodyBytes) }),
        })
      ).status,
    ).toBe(413);
    expect((await fetch(`${origin}/healthz`)).status).toBe(200);
  });
});

describe("remoteOptionsFromEnvironment", () => {
  it("binds this computer only by default and reads the port", () => {
    expect(remoteOptionsFromEnvironment({})).toMatchObject({ host: "127.0.0.1", port: 8090 });
    expect(remoteOptionsFromEnvironment({ DRAFT_LOOP_MCP_PORT: "9000" }).port).toBe(9000);
    expect(() => remoteOptionsFromEnvironment({ DRAFT_LOOP_MCP_PORT: "many" })).toThrow();
  });
});
