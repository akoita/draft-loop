import Anthropic from "@anthropic-ai/sdk";
import type { ClaudeSearchClient } from "@draft-loop/model-gateway";
import { describe, expect, it } from "vitest";

import { WorkerConfigError } from "./config-error.js";
import { researchSearchFor } from "./research-search-wiring.js";
import type { WorkerModelRoutes } from "./route-config.js";

const direct: WorkerModelRoutes = {
  kind: "direct",
  direct: { secretsDirectory: "/run/secrets", openAiEndpoint: "global" },
};
const vertexGateway = {
  vertexProjectId: "example-project",
  vertexLocation: "eu",
  vertexPriceFactor: 1.1,
};
const vertex = { kind: "vertex", gateway: vertexGateway } as unknown as WorkerModelRoutes;
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

  it("moves a search Vertex AI refuses for quota to the Claude API once, at its prices", async () => {
    const withFallback = {
      kind: "vertex",
      gateway: { ...vertexGateway, anthropicKeySecret: "anthropic-key" },
    } as unknown as WorkerModelRoutes;
    const refusals: number[] = [];
    const refusing = (status: number) => async () =>
      ({
        messages: {
          create: async () => {
            refusals.push(status);
            throw new Anthropic.APIError(status, undefined, "RESOURCE_EXHAUSTED", new Headers());
          },
        },
      }) as ClaudeSearchClient;
    const scripted = claudeClient();
    const search = researchSearchFor(
      {},
      withFallback,
      {},
      { claudeClient: refusing(429), fallbackClaudeClient: scripted.claudeClient },
    );
    const reply = await search?.search(request);
    expect(reply?.provider).toBe("claude-api-fallback");
    // Priced as the Claude API: no Vertex factor on the tokens.
    expect(reply?.costUsd).toBeCloseTo(0.01 + 0.1, 6);
    expect(scripted.bodies).toHaveLength(1);
    expect(scripted.bodies[0]?.tools?.[0]).toMatchObject({ type: "web_search_20250305" });

    // Another failure stays a failure, and nothing reaches the Claude API.
    const other = claudeClient();
    const failing = researchSearchFor(
      {},
      withFallback,
      {},
      { claudeClient: refusing(500), fallbackClaudeClient: other.claudeClient },
    );
    await expect(failing?.search(request)).rejects.toMatchObject({ code: "status_500" });
    expect(other.bodies).toHaveLength(0);

    // Without the deployment's fallback, a quota refusal fails as before.
    const alone = researchSearchFor({}, vertex, {}, { claudeClient: refusing(429) });
    await expect(alone?.search(request)).rejects.toMatchObject({ code: "status_429" });
    expect(refusals).toEqual([429, 500, 429]);
  });
});
