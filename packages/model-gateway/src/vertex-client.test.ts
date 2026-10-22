import { ProviderAdapterError } from "@draft-loop/providers";
import { describe, expect, it } from "vitest";

import { createVertexAnthropicAdapter, createVertexAnthropicClient } from "./vertex-client.js";
import { VertexLocationError } from "./vertex-location.js";
import { vertexPricing } from "./vertex-pricing.js";
import { auth, model, request, scriptedVertex } from "./vertex-test-support.js";

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
