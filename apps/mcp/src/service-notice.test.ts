import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import { createWorkJournalApi } from "./client.js";
import { createWorkJournalMcpServer } from "./server.js";
import { createServiceNoticeApi } from "./service-notice.js";

const notice = {
  kind: "maintenance",
  startsAt: "2026-12-01T19:00:00Z",
  endsAt: "2026-12-01T21:00:00Z",
  readOnly: true,
  state: "upcoming",
};

function scripted(answer: () => Response) {
  const requests: { url: string; authorization: string | undefined }[] = [];
  const config = {
    baseUrl: "http://127.0.0.1:8080/",
    workspaceId: "owner",
    token: async () => "dlagent_fixture",
    fetch: (async (url: string, init: RequestInit) => {
      const headers = new Headers(init.headers);
      requests.push({ url, authorization: headers.get("authorization") ?? undefined });
      return answer();
    }) as typeof fetch,
  };
  return { config, requests };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function connect(config: ReturnType<typeof scripted>["config"]) {
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
    createServiceNoticeApi(config),
  );
  const client = new Client({ name: "test-host", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe("service_notice (#2967)", () => {
  it("reads the public notice without sending the token", async () => {
    const { config, requests } = scripted(() => json({ notice }));
    const client = await connect(config);

    const result = await client.callTool({ name: "service_notice", arguments: {} });

    expect(result.structuredContent).toEqual({ notice });
    expect(requests).toEqual([
      { url: "http://127.0.0.1:8080/v1/service-notice", authorization: undefined },
    ]);
  });

  it("answers no notice from a server that predates the route", async () => {
    const { config } = scripted(() => json({ error: { code: "not_found" } }, 404));
    const client = await connect(config);

    const result = await client.callTool({ name: "service_notice", arguments: {} });

    expect(result.structuredContent).toEqual({ notice: null });
  });

  it("says a failure may pass on retry when the server is unavailable", async () => {
    const { config } = scripted(() => json({}, 503));
    const client = await connect(config);

    const result = await client.callTool({ name: "service_notice", arguments: {} });

    expect(result.isError).toBe(true);
  });

  it("is listed for agents and named in the server's instructions", async () => {
    const { config } = scripted(() => json({ notice: null }));
    const client = await connect(config);

    const tools = await client.listTools();

    expect(tools.tools.map((tool) => tool.name)).toContain("service_notice");
    expect(client.getInstructions()).toContain("service_maintenance");
  });
});
