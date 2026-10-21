import type { ModelSelection } from "@draft-loop/domain";
import { ProviderAdapterError } from "@draft-loop/providers";
import { describe, expect, it } from "vitest";

import { createVertexAnthropicAdapter, createVertexAnthropicClient } from "./vertex-client.js";
import { VertexLocationError } from "./vertex-location.js";
import { vertexPricing } from "./vertex-pricing.js";

const model: ModelSelection = {
  company: "anthropic",
  modelId: "claude-sonnet-5-5",
  role: "author",
  promptTemplateVersion: "author-v1",
};

const policy = {
  allowTransmission: true,
  allowedCompanies: ["anthropic", "openai"],
  sensitiveData: false,
  sensitiveDataAcknowledged: false,
} as const;

const schema = {
  type: "object",
  properties: { answer: { type: "string" } },
  required: ["answer"],
  additionalProperties: false,
} as const;

const request = {
  contextSnapshotId: "snapshot-1",
  model,
  systemPrompt: "Return the requested data as JSON.",
  input: { question: "What is the answer?" },
  outputSchema: schema,
  outputName: "answer_schema",
  dataPolicy: policy,
};

/** A streamed Messages response, as Vertex AI sends it from `streamRawPredict`. */
function streamedMessage(modelId: string): string {
  const events: [string, unknown][] = [
    [
      "message_start",
      {
        type: "message_start",
        message: {
          id: "msg-1",
          type: "message",
          role: "assistant",
          model: modelId,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 1000, output_tokens: 0 },
        },
      },
    ],
    [
      "content_block_start",
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    ],
    [
      "content_block_delta",
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: '{"answer":"yes"}' },
      },
    ],
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    [
      "message_delta",
      {
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { output_tokens: 500 },
      },
    ],
    ["message_stop", { type: "message_stop" }],
  ];
  return events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join("");
}

/** A Google auth client that hands out a fixed token, standing in for the runtime identity. */
const auth = {
  authClient: {
    projectId: "synthetic-project",
    getRequestHeaders: async () => new Headers({ authorization: "Bearer synthetic-token" }),
  } as unknown as NonNullable<
    Parameters<typeof createVertexAnthropicClient>[0]["auth"]
  >["authClient"],
};

function scriptedVertex() {
  const calls: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({ url, headers: new Headers(init?.headers), body });
    return new Response(streamedMessage("claude-sonnet-5-5"), {
      status: 200,
      headers: { "content-type": "text/event-stream", "request-id": "vertex-request-1" },
    });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe("Claude on Vertex AI", () => {
  it("calls the eu endpoint with the runtime token and records the vertex-ai route and cost", async () => {
    const { calls, fetchImpl } = scriptedVertex();
    const client = createVertexAnthropicClient({
      projectId: "synthetic-project",
      location: "eu",
      auth,
      fetch: fetchImpl,
    });
    const adapter = createVertexAnthropicAdapter(client, {
      configuredModel: model,
      pricing: { inputUsdPerMillionTokens: 2, outputUsdPerMillionTokens: 10 },
      locationPriceFactor: 1.1,
    });

    const response = await adapter.execute(request);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      "https://aiplatform.eu.rep.googleapis.com/v1/projects/synthetic-project/locations/eu/publishers/anthropic/models/claude-sonnet-5-5:streamRawPredict",
    );
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer synthetic-token");
    expect(calls[0]?.headers.has("x-api-key")).toBe(false);
    expect(calls[0]?.body).toMatchObject({ anthropic_version: "vertex-2023-10-16", stream: true });
    expect(calls[0]?.body.model).toBeUndefined();
    expect(response).toMatchObject({
      output: { answer: "yes" },
      provider: "anthropic",
      company: "anthropic",
      route: "vertex-ai",
      modelId: "claude-sonnet-5-5",
      providerRequestId: "vertex-request-1",
      usage: { inputTokens: 1000, outputTokens: 500, totalTokens: 1500 },
    });
    // (1,000 × $2 + 500 × $10) per million tokens, times the 1.1 location factor.
    expect(response.cost.estimatedUsd).toBeCloseTo(0.0077, 10);
  });

  it("uses a europe-* region's own endpoint", async () => {
    const { calls, fetchImpl } = scriptedVertex();
    const client = createVertexAnthropicClient({
      projectId: "synthetic-project",
      location: "europe-west1",
      auth,
      fetch: fetchImpl,
    });

    await createVertexAnthropicAdapter(client, {
      configuredModel: model,
      locationPriceFactor: 1,
    }).execute(request);

    expect(calls[0]?.url).toMatch(
      /^https:\/\/europe-west1-aiplatform\.googleapis\.com\/v1\/projects\/synthetic-project\/locations\/europe-west1\//u,
    );
  });

  it.each(["global", "us", "us-east5", "asia-southeast1", "europe", ""])(
    "refuses the location %j, which is not inside the EU",
    (location) => {
      expect(() =>
        createVertexAnthropicClient({ projectId: "synthetic-project", location }),
      ).toThrow(VertexLocationError);
    },
  );

  it("refuses a model that is not listed, before any call and without substituting one", async () => {
    const { calls, fetchImpl } = scriptedVertex();
    const client = createVertexAnthropicClient({
      projectId: "synthetic-project",
      location: "eu",
      auth,
      fetch: fetchImpl,
    });
    const unlisted = { ...model, modelId: "claude-sonnet-4-5" };

    expect(() =>
      createVertexAnthropicAdapter(client, { configuredModel: unlisted, locationPriceFactor: 1 }),
    ).toThrow(ProviderAdapterError);
    expect(() =>
      client.messages.create({
        model: "claude-sonnet-4-5",
        max_tokens: 16,
        messages: [{ role: "user", content: "hi" }],
      }),
    ).toThrow(/not offered through Claude on Vertex AI/u);
    expect(calls).toHaveLength(0);
  });
});

describe("vertexPricing", () => {
  it("scales every rate by the location factor and keeps the prompt-size limit", () => {
    expect(
      vertexPricing(
        {
          inputUsdPerMillionTokens: 2,
          outputUsdPerMillionTokens: 10,
          cachedInputUsdPerMillionTokens: 0.2,
          cacheWriteInputUsdPerMillionTokens: 2.5,
          maxInputTokens: 200_000,
        },
        1.5,
      ),
    ).toEqual({
      inputUsdPerMillionTokens: 3,
      outputUsdPerMillionTokens: 15,
      cachedInputUsdPerMillionTokens: 0.30000000000000004,
      cacheWriteInputUsdPerMillionTokens: 3.75,
      maxInputTokens: 200_000,
    });
  });

  it.each([0.9, Number.NaN, Number.POSITIVE_INFINITY])("refuses the factor %s", (factor) => {
    expect(() =>
      vertexPricing({ inputUsdPerMillionTokens: 1, outputUsdPerMillionTokens: 1 }, factor),
    ).toThrow(RangeError);
  });
});
