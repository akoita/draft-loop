import type { AnthropicClient } from "@draft-loop/providers";
import { describe, expect, it, vi } from "vitest";

import {
  createHostedAnthropicRoute,
  createOpenAiClient,
  createOpenAiEuClient,
  openAiEuBaseUrl,
  openAiGlobalBaseUrl,
} from "./hosted-routes.js";
import { auth, model, request, scriptedVertex } from "./vertex-test-support.js";

const pricing = { inputUsdPerMillionTokens: 3, outputUsdPerMillionTokens: 15 };

/** A direct Claude API client that answers once, standing in for the fallback route. */
function directClient() {
  const create = vi.fn(() =>
    Object.assign(
      Promise.resolve({
        id: "msg-direct",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-5-5",
        content: [{ type: "text", text: '{"answer":"yes"}' }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 1000, output_tokens: 500 },
      }),
      {
        withResponse: async () => ({
          data: {
            id: "msg-direct",
            type: "message",
            role: "assistant",
            model: "claude-sonnet-5-5",
            content: [{ type: "text", text: '{"answer":"yes"}' }],
            stop_reason: "end_turn",
            stop_sequence: null,
            usage: { input_tokens: 1000, output_tokens: 500 },
          },
          request_id: "direct-request-1",
        }),
      },
    ),
  );
  return { client: { messages: { create } } as unknown as AnthropicClient, create };
}

function route(status: number, fallback: { key?: string } | undefined) {
  const vertex = scriptedVertex(status);
  const direct = directClient();
  const resolveCredential = vi.fn(async () => fallback?.key);
  const build = createHostedAnthropicRoute({
    vertex: {
      projectId: "synthetic-project",
      location: "eu",
      locationPriceFactor: 1.1,
      auth,
      fetch: vertex.fetchImpl,
    },
    anthropicFallback: fallback !== undefined,
    resolveCredential,
    anthropicApiClient: () => direct.client,
  });
  return {
    adapter: build({ configuredModel: model, pricing, retry: { maxRetries: 0 } }),
    vertex,
    direct,
    resolveCredential,
  };
}

describe("hosted Anthropic route", () => {
  it("serves the author from Claude on Vertex AI at the location's price, reading no key", async () => {
    const { adapter, vertex, resolveCredential } = route(200, undefined);

    const response = await adapter.execute(request);

    expect(response.route).toBe("vertex-ai");
    expect(response.routeFallback).toBeUndefined();
    // 1,000 input and 500 output tokens at US$3 and US$15 per million, times 1.1.
    expect(response.cost.estimatedUsd).toBeCloseTo(0.01155, 8);
    expect(vertex.calls[0]?.url).toContain("aiplatform.eu.rep.googleapis.com");
    expect(resolveCredential).not.toHaveBeenCalled();
  });

  it("never leaves Vertex AI when the deployment has no fallback", async () => {
    const { adapter, direct } = route(404, undefined);

    await expect(adapter.execute(request)).rejects.toThrow();
    expect(direct.create).not.toHaveBeenCalled();
  });

  it("falls back to the direct Claude API with a Secret Manager key, and records why", async () => {
    const { adapter, direct, resolveCredential } = route(404, { key: "synthetic-claude-key" });

    const response = await adapter.execute(request);

    expect(response.route).toBe("anthropic-api");
    expect(response.routeFallback).toEqual({ from: "vertex-ai", cause: "model-not-offered" });
    expect(resolveCredential).toHaveBeenCalledWith("anthropic");
    expect(direct.create).toHaveBeenCalledOnce();
  });

  it("refuses the fallback when its key is missing", async () => {
    const { adapter, direct } = route(404, {});

    await expect(adapter.execute(request)).rejects.toThrow("fallback route is not configured");
    expect(direct.create).not.toHaveBeenCalled();
  });
});

describe("OpenAI client", () => {
  it("targets the European data-residency endpoint", () => {
    expect(createOpenAiEuClient("synthetic-openai-key").baseURL).toBe(openAiEuBaseUrl);
  });

  it("targets the global endpoint only when asked", () => {
    expect(createOpenAiClient("synthetic-openai-key", "eu").baseURL).toBe(openAiEuBaseUrl);
    expect(createOpenAiClient("synthetic-openai-key", "global").baseURL).toBe(openAiGlobalBaseUrl);
  });
});
