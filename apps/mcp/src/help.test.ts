import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import { createWorkJournalApi, createWorkspaceApiCall } from "./client.js";
import { createHelpApi, helpMarkdown } from "./help.js";
import { createWorkJournalMcpServer } from "./server.js";

const base = "http://127.0.0.1:8080/v1/workspaces/owner";

const guide = {
  language: "en",
  intro: "Redakloop turns your career evidence into a CV for one job.",
  query: null,
  sections: [
    { id: "evidence", title: "Add your career evidence", paragraphs: ["From Home, open it."] },
    { id: "review", title: "Review and export", paragraphs: ["Approve, then Export."] },
  ],
};

function scripted(body: unknown) {
  const requests: string[] = [];
  const config = {
    baseUrl: "http://127.0.0.1:8080",
    workspaceId: "owner",
    token: async () => "dlagent_fixture",
    fetch: (async (url: string, init: RequestInit) => {
      requests.push(`${init.method ?? "GET"} ${url}`);
      return new Response(JSON.stringify(body), {
        status: 200,
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
    createHelpApi(call),
  );
  const client = new Client({ name: "test-host", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe("search_help and the guide resources (#2881)", () => {
  it("searches the guide through the record's address, in the language asked", async () => {
    const found = { ...guide, language: "fr", query: "export", sections: [guide.sections[1]] };
    const { config, requests } = scripted(found);
    const client = await connect(config);

    const result = await client.callTool({
      name: "search_help",
      arguments: { query: " export ", language: "fr" },
    });

    expect(requests).toEqual([`GET ${base}/help?language=fr&q=export`]);
    expect(result.structuredContent).toEqual({
      language: "fr",
      query: "export",
      sections: [guide.sections[1]],
    });
  });

  it("reads the whole guide in English when no query or language is given", async () => {
    const { config, requests } = scripted(guide);
    const client = await connect(config);

    await client.callTool({ name: "search_help", arguments: {} });

    expect(requests).toEqual([`GET ${base}/help?language=en`]);
  });

  it("lists a Markdown resource per language and reads it from the API", async () => {
    const { config } = scripted(guide);
    const client = await connect(config);

    const { resources } = await client.listResources();
    expect(resources.map((resource) => resource.uri)).toEqual(
      expect.arrayContaining(["draftloop://help/guide/en", "draftloop://help/guide/fr"]),
    );
    const read = await client.readResource({ uri: "draftloop://help/guide/en" });
    expect(read.contents[0]).toMatchObject({ mimeType: "text/markdown" });
    expect(read.contents[0]).toMatchObject({ text: helpMarkdown(guide as never) });
    expect(helpMarkdown(guide as never)).toContain("## Review and export\n\nApprove, then Export.");
  });
});
