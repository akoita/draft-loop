import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import { createDraftLoopMcpServer, mayBeOperatorToken } from "./remote.js";

const note = {
  noteId: "note-1",
  kind: "note",
  organisationId: "org-north",
  memberId: "member-1",
  category: "bug",
  screen: "review",
  text: "The export button does nothing.",
  transcript: null,
  context: { source: "web", route: "/#review", serverRelease: "server-v0.40.0", plan: "free" },
  status: "new",
  issueUrl: null,
  triagedAt: null,
  sentAt: "2026-11-16T10:00:00.000Z",
};

function scripted(token: string, status: number, body: unknown) {
  const requests: { line: string; body: unknown }[] = [];
  const config = {
    baseUrl: "http://127.0.0.1:8080",
    workspaceId: "owner",
    token: async () => token,
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

async function connect(config: ReturnType<typeof scripted>["config"], operator: boolean) {
  const server = createDraftLoopMcpServer(config, { operator });
  const client = new Client({ name: "test-host", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe("the operator's feedback tools (#2877)", () => {
  it("are offered only with a credential that may be the operator's", async () => {
    expect(mayBeOperatorToken("owner-token-for-tests")).toBe(true);
    expect(mayBeOperatorToken("dlagent_fixture")).toBe(false);
    expect(mayBeOperatorToken(undefined)).toBe(false);

    const member = await connect(scripted("dlagent_fixture", 200, {}).config, false);
    const operator = await connect(scripted("owner-token-for-tests", 200, {}).config, true);
    const names = async (client: Client) =>
      (await client.listTools()).tools.map((tool) => tool.name);

    expect(await names(member)).not.toContain("list_feedback");
    expect(await names(operator)).toEqual(
      expect.arrayContaining(["list_feedback", "triage_feedback", "send_feedback"]),
    );
    await member.close();
    await operator.close();
  });

  it("lists notes by status with their context", async () => {
    const { config, requests } = scripted("owner-token-for-tests", 200, { notes: [note] });
    const client = await connect(config, true);

    const listed = await client.callTool({
      name: "list_feedback",
      arguments: { status: "new", limit: 20 },
    });

    expect(requests.map(({ line }) => line)).toEqual([
      "GET http://127.0.0.1:8080/v1/operator/feedback?status=new&limit=20",
    ]);
    expect(listed.structuredContent).toEqual({ notes: [note] });
    await client.close();
  });

  it("triages a note with its issue link", async () => {
    const issueUrl = "https://github.com/example-org/example-repo/issues/12";
    const { config, requests } = scripted("owner-token-for-tests", 200, {
      ...note,
      status: "issue",
      issueUrl,
      triagedAt: "2026-11-16T11:00:00.000Z",
    });
    const client = await connect(config, true);

    const triaged = await client.callTool({
      name: "triage_feedback",
      arguments: { note_id: "note-1", status: "issue", issue_url: issueUrl },
    });

    expect(requests).toEqual([
      {
        line: "PATCH http://127.0.0.1:8080/v1/operator/feedback/note-1",
        body: { status: "issue", issueUrl },
      },
    ]);
    expect(triaged.structuredContent).toMatchObject({ status: "issue", issueUrl });
    await client.close();
  });

  it("refuses a link that is not a GitHub issue before calling the API", async () => {
    const { config, requests } = scripted("owner-token-for-tests", 200, note);
    const client = await connect(config, true);

    const refused = await client.callTool({
      name: "triage_feedback",
      arguments: { note_id: "note-1", status: "issue", issue_url: "https://example.test/12" },
    });

    expect(refused.isError).toBe(true);
    expect(requests).toEqual([]);
    await client.close();
  });

  it("says the tools need the operator's credential when the API refuses the token", async () => {
    const { config } = scripted("not-the-owner-token", 401, {
      error: { code: "unauthorized", message: "The operator's token is required." },
    });
    const client = await connect(config, true);

    const refused = await client.callTool({ name: "list_feedback", arguments: {} });

    expect(refused.isError).toBe(true);
    expect(JSON.stringify(refused.content)).toContain("operator_only");
    await client.close();
  });
});
