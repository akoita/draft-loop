import type { ClaudeSearchClient } from "@draft-loop/model-gateway";
import { describe, expect, it } from "vitest";

import { WorkerConfigError } from "./config-error.js";
import { researchSearchFor } from "./research-search-wiring.js";
import type { WorkerModelRoutes } from "./route-config.js";

const direct: WorkerModelRoutes = {
  kind: "direct",
  direct: { secretsDirectory: "/run/secrets", openAiEndpoint: "global" },
};
const vertex = {
  kind: "vertex",
  gateway: { vertexProjectId: "example-project", vertexLocation: "eu", vertexPriceFactor: 1.1 },
} as unknown as WorkerModelRoutes;
const request = { query: "Example Corp news", fromDate: "2025-11-08", maxResults: 5 };

// An invented page only.
function claudeClient() {
  const bodies: Parameters<ClaudeSearchClient["messages"]["create"]>[0][] = [];
  const client: ClaudeSearchClient = {
    messages: {
      create: async (body) => {
        bodies.push(body);
        return {
          stop_reason: "end_turn",
          content: [
            {
              type: "web_search_tool_result",
              content: [{ url: "https://example.org/a", title: "News", page_age: null }],
            },
            {
              type: "text",
              text: "A data team.",
              citations: [
                {
                  type: "web_search_result_location",
                  url: "https://example.org/a",
                  cited_text: "A data team.",
                },
              ],
            },
          ],
          usage: {
            input_tokens: 1_000_000,
            output_tokens: 0,
            server_tool_use: { web_search_requests: 1 },
          },
        } as never;
      },
    },
  };
  return { bodies, claudeClient: async () => client };
}

describe("research search wiring", () => {
  it("searches nothing when off or on fixtures, and refuses an unknown setting", () => {
    const local = { resolveCredential: async () => "key" };
    expect(researchSearchFor({ DRAFT_LOOP_RESEARCH_SEARCH: "off" }, direct, local)).toBeUndefined();
    expect(researchSearchFor({}, undefined, local)).toBeUndefined();
    expect(() => researchSearchFor({ DRAFT_LOOP_RESEARCH_SEARCH: "bing" }, direct, local)).toThrow(
      WorkerConfigError,
    );
  });

  it("searches with Claude by default, on the route's client and its prices", async () => {
    const scripted = claudeClient();
    const search = researchSearchFor({}, vertex, {}, { claudeClient: scripted.claudeClient });
    const reply = await search?.search(request);
    expect(reply?.provider).toBe("claude");
    expect(reply?.sources.map((source) => source.url)).toEqual(["https://example.org/a"]);
    // One search at US$0.01 plus a million input tokens at Haiku's US$0.10, times Vertex's 1.1.
    expect(reply?.costUsd).toBeCloseTo(0.01 + 0.11, 6);
    expect(scripted.bodies[0]?.tools?.[0]).toMatchObject({ type: "web_search_20250305" });
  });

  it("reads the Linkup key as linkup from the route's key source", async () => {
    const asked: string[] = [];
    const fetch = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({ results: [] }),
    })) as unknown as typeof globalThis.fetch;
    const search = researchSearchFor(
      { DRAFT_LOOP_RESEARCH_SEARCH: "linkup" },
      direct,
      {
        resolveCredential: async (provider) => {
          asked.push(provider);
          return "lk-test";
        },
      },
      { fetch },
    );
    expect((await search?.search(request))?.provider).toBe("linkup");
    expect(asked).toEqual(["linkup"]);
  });
});
