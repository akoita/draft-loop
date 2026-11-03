import type { WorkJournalNoteListItem } from "@draft-loop/schemas/work-journal";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import {
  configFromEnvironment,
  createWorkJournalApi,
  type ListWorkQuery,
  type WorkJournalApi,
} from "./client.js";
import { createWorkJournalMcpServer, guideText, serverInstructions } from "./server.js";

// Fictional project and links only.
const note = {
  title: "Card payments for the Fernhill booking site",
  summary:
    "Added card payments to the booking flow with a hosted checkout page and webhook handling for paid bookings.",
  period: { start: "2026-10-12" },
  project: { name: "Fernhill bookings", visibility: "private" },
  technologies: ["TypeScript", "Stripe"],
  category: "payments",
  candidate_role: ["implemented"],
  links: [{ kind: "pull-request", url: "https://git.example.test/fernhill/bookings/pull/42" }],
};

const listed: WorkJournalNoteListItem = {
  id: "wjn_fixture_0001",
  title: note.title,
  project: "Fernhill bookings",
  period: { start: "2026-10-12" },
  technologies: ["TypeScript", "Stripe"],
  category: "payments",
  status: "pending",
  created_at: "2026-11-03T10:00:00.000Z",
};

function scriptedApi() {
  const calls: { record: { note: unknown; key: string | undefined }[]; list: ListWorkQuery[] } = {
    record: [],
    list: [],
  };
  const api: WorkJournalApi = {
    record: async (sent, key) => {
      calls.record.push({ note: sent, key });
      return {
        note_id: "wjn_fixture_0001",
        status: "pending",
        possible_duplicate_of: [],
        screening: "clear",
        message: "Recorded for the candidate's review.",
      };
    },
    list: async (query) => {
      calls.list.push(query);
      return [listed];
    },
  };
  return { api, calls };
}

async function connect(api: WorkJournalApi) {
  const server = createWorkJournalMcpServer(api);
  const client = new Client({ name: "test-host", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe("DraftLoop MCP server", () => {
  it("lists the two tools with their hints, the guide and the prompt", async () => {
    const client = await connect(scriptedApi().api);
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(["list_work", "record_work"]);
    const record = tools.find((tool) => tool.name === "record_work");
    expect(record?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(record?.description).toContain("Never include");
    expect(tools.find((tool) => tool.name === "list_work")?.annotations?.readOnlyHint).toBe(true);
    expect(client.getInstructions()).toBe(serverInstructions);

    const guide = await client.readResource({ uri: "draftloop://work-journal/guide" });
    expect(guide.contents[0]).toMatchObject({ mimeType: "text/markdown", text: guideText });
    const prompt = await client.getPrompt({ name: "log-notable-work" });
    expect(JSON.stringify(prompt.messages)).toContain("list_work");
    await client.close();
  });

  it("records a note with a stable idempotency key and returns the structured answer", async () => {
    const { api, calls } = scriptedApi();
    const client = await connect(api);
    const first = await client.callTool({ name: "record_work", arguments: note });
    await client.callTool({ name: "record_work", arguments: note });
    expect(first.isError).not.toBe(true);
    expect(first.structuredContent).toEqual({
      note_id: "wjn_fixture_0001",
      status: "pending",
      possible_duplicate_of: [],
      screening: "clear",
      message: "Recorded for the candidate's review.",
    });
    expect(calls.record).toHaveLength(2);
    expect(calls.record[0]?.key).toMatch(/^mcp-[0-9a-f]{48}$/u);
    expect(calls.record[1]?.key).toBe(calls.record[0]?.key);
    await client.close();
  });

  it("refuses an invalid note before calling the API", async () => {
    const { api, calls } = scriptedApi();
    const client = await connect(api);
    const answer = await client.callTool({
      name: "record_work",
      arguments: { ...note, title: "" },
    });
    expect(answer.isError).toBe(true);
    expect(calls.record).toEqual([]);
    await client.close();
  });

  it("lists recorded work without summaries or links", async () => {
    const { api, calls } = scriptedApi();
    const client = await connect(api);
    const answer = await client.callTool({
      name: "list_work",
      arguments: { project: "Fernhill bookings", limit: 5 },
    });
    expect(calls.list).toEqual([{ project: "Fernhill bookings", limit: 5 }]);
    const text = JSON.stringify(answer);
    expect(text).toContain("wjn_fixture_0001");
    expect(text).not.toContain("hosted checkout");
    expect(text).not.toContain("git.example.test");
    await client.close();
  });

  it("answers not_signed_in without a token, through the real HTTP client", async () => {
    let fetched = false;
    const api = createWorkJournalApi({
      ...configFromEnvironment({}),
      fetch: async () => {
        fetched = true;
        return new Response("{}");
      },
    });
    const client = await connect(api);
    const answer = await client.callTool({ name: "record_work", arguments: note });
    expect(answer.isError).toBe(true);
    const content = answer.content as { type: string; text: string }[];
    expect(JSON.parse(content[0]?.text ?? "{}").error.code).toBe("not_signed_in");
    expect(fetched).toBe(false);
    await client.close();
  });
});

describe("DraftLoop MCP HTTP client", () => {
  it("sends the bearer token and idempotency key, and maps refusals and 401", async () => {
    const requests: { url: string; init: RequestInit }[] = [];
    const answers = [
      new Response(JSON.stringify({ status: "validated", possible_duplicate_of: [], message: "" })),
      new Response(
        JSON.stringify({
          error: {
            code: "link_not_https",
            message: "Links must use https.",
            issues: [{ path: "links.0.url" }],
          },
        }),
        { status: 422 },
      ),
      new Response("{}", { status: 401 }),
    ];
    const api = createWorkJournalApi({
      baseUrl: "http://127.0.0.1:8080/",
      workspaceId: "owner",
      token: async () => "fixture-token",
      fetch: async (url, init) => {
        requests.push({ url: String(url), init: init ?? {} });
        return answers.shift() ?? new Response("{}");
      },
    });
    await expect(api.record(note, "key-1")).resolves.toMatchObject({ status: "validated" });
    expect(requests[0]?.url).toBe("http://127.0.0.1:8080/v1/workspaces/owner/work-journal/notes");
    expect(requests[0]?.init.headers).toMatchObject({
      authorization: "Bearer fixture-token",
      "idempotency-key": "key-1",
    });
    await expect(api.record(note)).rejects.toMatchObject({
      code: "link_not_https",
      fields: ["links.0.url"],
    });
    await expect(api.list({})).rejects.toMatchObject({ code: "not_signed_in" });
  });

  it("reports an unreachable server", async () => {
    const api = createWorkJournalApi({
      baseUrl: "http://127.0.0.1:1",
      workspaceId: "owner",
      token: async () => "fixture-token",
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    });
    await expect(api.list({ limit: 3 })).rejects.toMatchObject({ code: "server_unreachable" });
  });
});
