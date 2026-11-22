import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import { createWorkJournalApi, createWorkspaceApiCall } from "./client.js";
import { createFeedbackApi } from "./feedback.js";
import { createWorkJournalMcpServer } from "./server.js";

const base = "http://127.0.0.1:8080/v1/workspaces/owner";

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
    createFeedbackApi(call),
  );
  const client = new Client({ name: "test-host", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe("send_feedback (#2843)", () => {
  it("sends the candidate's note from the agent and says nobody replies in Redakloop", async () => {
    const { config, requests } = scripted(201, {
      noteId: "note-1",
      organisationId: "org-north",
      memberId: "member-1",
      category: "idea",
      screen: "agent",
      text: "Please add a Spanish screen.",
      sentAt: "2026-11-16T23:00:00.000Z",
    });
    const client = await connect(config);

    const sent = await client.callTool({
      name: "send_feedback",
      arguments: { text: "  Please add a Spanish screen. ", category: "idea" },
    });

    expect(sent.structuredContent).toEqual({
      note_id: "note-1",
      sent_at: "2026-11-16T23:00:00.000Z",
      next_step: "Sent. The people who run Redakloop read it; there is no reply in Redakloop.",
    });
    expect(requests).toEqual([
      {
        line: `POST ${base}/feedback`,
        body: { text: "Please add a Spanish screen.", screen: "agent", category: "idea" },
      },
    ]);
    const { tools } = await client.listTools();
    expect(tools.find(({ name }) => name === "send_feedback")?.annotations?.readOnlyHint).toBe(
      false,
    );
    await client.close();
  });

  it("passes on a refusal for a token without the journal scope", async () => {
    const { config } = scripted(403, {
      error: { code: "forbidden", message: 'This agent token lacks the "journal" scope.' },
    });
    const client = await connect(config);

    const refused = await client.callTool({ name: "send_feedback", arguments: { text: "Hi." } });

    expect(refused.isError).toBe(true);
    await client.close();
  });

  it("refuses an empty note before calling Redakloop", async () => {
    const { config, requests } = scripted(201, {});
    const client = await connect(config);

    const refused = await client.callTool({ name: "send_feedback", arguments: { text: "   " } });

    expect(refused.isError).toBe(true);
    expect(requests).toEqual([]);
    await client.close();
  });
});
