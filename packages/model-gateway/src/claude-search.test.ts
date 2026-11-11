import type Anthropic from "@anthropic-ai/sdk";
import { withBoundedResearchSources } from "@draft-loop/application/research-search";
import { describe, expect, it } from "vitest";

import {
  type ClaudeSearchClient,
  ClaudeSearchError,
  claudePageAgeDate,
  claudeWebSearchTool,
  createClaudeResearchSearch,
  directClaudeSearchClient,
} from "./claude-search.js";

const request = {
  query: "Example employer data analyst",
  fromDate: "2025-11-08",
  maxResults: 5,
  includeDomains: ["example.org"],
};

function reply(content: unknown[], overrides: Record<string, unknown> = {}): Anthropic.Message {
  return {
    id: "msg_fixture",
    type: "message",
    role: "assistant",
    model: "claude-haiku-5-5",
    stop_reason: "end_turn",
    content,
    usage: {
      input_tokens: 10_000,
      output_tokens: 500,
      server_tool_use: { web_search_requests: 2 },
    },
    ...overrides,
  } as unknown as Anthropic.Message;
}

function scripted(message: Anthropic.Message | Error) {
  const bodies: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const client: ClaudeSearchClient = {
    messages: {
      create: async (body) => {
        bodies.push(body);
        if (message instanceof Error) throw message;
        return message;
      },
    },
  };
  return { bodies, clientFor: async () => client };
}

const results = {
  type: "web_search_tool_result",
  tool_use_id: "srvtoolu_1",
  content: [
    {
      type: "web_search_result",
      url: "https://example.org/news",
      title: "News",
      page_age: "October 3, 2026",
      encrypted_content: "x",
    },
    {
      type: "web_search_result",
      url: "https://example.org/uncited",
      title: "Uncited",
      page_age: null,
      encrypted_content: "x",
    },
  ],
};

const cite = (url: string, cited_text: string) => ({
  type: "web_search_result_location",
  url,
  title: "News",
  cited_text,
  encrypted_index: "i",
});

describe("Claude research search", () => {
  it("asks for the window and domains and keeps the passages Claude cited", async () => {
    const { bodies, clientFor } = scripted(
      reply([
        results,
        {
          type: "text",
          text: "They are hiring.",
          citations: [
            cite("https://example.org/news", "The team is hiring."),
            cite("https://example.org/news", "The team is hiring."),
            cite("https://example.org/elsewhere", "Not a result."),
          ],
        },
      ]),
    );
    const search = withBoundedResearchSources(
      createClaudeResearchSearch({ clientFor, route: "anthropic-api" }),
    );
    const answer = await search.search(request);
    expect(answer.sources).toEqual([
      {
        url: "https://example.org/news",
        title: "News",
        excerpt: "The team is hiring.",
        publishedOn: "2026-10-03",
      },
    ]);
    expect(answer.provider).toBe("claude");
    // Two searches at US$0.01 and Haiku's tokens.
    expect(answer.costUsd).toBeCloseTo(0.02 + 0.001 + 0.00025, 6);
    expect(bodies[0]?.model).toBe("claude-haiku-5-5");
    expect(bodies[0]?.tools).toEqual([
      {
        type: "web_search_20250305",
        name: "web_search",
        max_uses: 3,
        allowed_domains: ["example.org"],
      },
    ]);
    expect(JSON.stringify(bodies[0]?.messages)).toContain("2025-11-08");
  });

  it("picks the tool variant each route and model accept", () => {
    expect(claudeWebSearchTool("anthropic-api", "claude-sonnet-5-5", 2, []).type).toBe(
      "web_search_20260209",
    );
    expect(claudeWebSearchTool("vertex", "claude-sonnet-5-5", 2, undefined).type).toBe(
      "web_search_20250305",
    );
  });

  it("fails without the content of the search or the key", async () => {
    const failed = scripted(
      reply([
        {
          type: "web_search_tool_result",
          tool_use_id: "srvtoolu_1",
          content: { type: "web_search_tool_result_error", error_code: "too_many_requests" },
        },
      ]),
    );
    await expect(
      createClaudeResearchSearch({ clientFor: failed.clientFor, route: "vertex" }).search(request),
    ).rejects.toMatchObject({ code: "too_many_requests" });

    const refused = scripted(reply([], { stop_reason: "refusal" }));
    await expect(
      createClaudeResearchSearch({ clientFor: refused.clientFor, route: "vertex" }).search(request),
    ).rejects.toMatchObject({ code: "refusal" });

    const broken = scripted(new Error("secret query text"));
    const error = await createClaudeResearchSearch({ clientFor: broken.clientFor, route: "vertex" })
      .search(request)
      .catch((caught: unknown) => caught as Error);
    expect(error).toBeInstanceOf(ClaudeSearchError);
    expect((error as Error).message).not.toContain("secret");

    await expect(directClaudeSearchClient(async () => undefined)()).rejects.toMatchObject({
      code: "no_key",
    });
  });

  it("dates each page from its absolute, ISO or relative page age (#2579)", () => {
    const searchedAt = new Date("2026-11-11T09:30:00Z");
    expect(claudePageAgeDate("October 3, 2026", searchedAt)).toBe("2026-10-03");
    expect(claudePageAgeDate("2026-09-30T23:30:00Z", searchedAt)).toBe("2026-09-30");
    expect(claudePageAgeDate("2 days ago", searchedAt)).toBe("2026-11-09");
    expect(claudePageAgeDate("a week ago", searchedAt)).toBe("2026-11-04");
    expect(claudePageAgeDate("3 Months ago", searchedAt)).toBe("2026-08-11");
    expect(claudePageAgeDate("1 year ago", searchedAt)).toBe("2025-11-11");
    expect(claudePageAgeDate("5 hours ago", searchedAt)).toBe("2026-11-11");
    expect(claudePageAgeDate("yesterday", searchedAt)).toBe("2026-11-10");
    for (const undated of [null, undefined, "", "recently", "2026-13-45"]) {
      expect(claudePageAgeDate(undated, searchedAt)).toBeUndefined();
    }
  });

  it("keeps a relative page age as a dated source, counted from the search time", async () => {
    const relative = {
      ...results,
      content: [{ ...results.content[0], page_age: "2 days ago" }],
    };
    const { clientFor } = scripted(
      reply([
        relative,
        { type: "text", text: "x", citations: [cite("https://example.org/news", "A")] },
      ]),
    );
    const search = createClaudeResearchSearch({
      route: "anthropic-api",
      clientFor,
      now: () => new Date("2026-11-11T09:30:00Z"),
    });
    const sources = (await search.search(request)).sources;
    expect(sources).toEqual([expect.objectContaining({ publishedOn: "2026-11-09" })]);
  });
});
