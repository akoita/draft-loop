import type { ModelSelection } from "@draft-loop/domain";
import {
  type JsonValue,
  type ModelRequest,
  type ModelResponse,
  ProviderAdapterError,
  type ProviderRoute,
} from "@draft-loop/providers";
import { describe, expect, it, vi } from "vitest";

import { createRoutedAdapter, type RouteAdapter, RoutePolicyError } from "./routed-adapter.js";

const model: ModelSelection = {
  company: "anthropic",
  modelId: "claude-sonnet-5-5",
  role: "author",
  promptTemplateVersion: "author-v1",
};

const request: ModelRequest = {
  contextSnapshotId: "snapshot-1",
  model,
  systemPrompt: "Return the requested data as JSON.",
  input: { question: "What is the answer?" },
  outputSchema: { type: "object" },
  outputName: "answer_schema",
  dataPolicy: {
    allowTransmission: true,
    allowedCompanies: ["anthropic", "openai"],
    sensitiveData: false,
    sensitiveDataAcknowledged: false,
  },
};

function response(route: ProviderRoute): ModelResponse<JsonValue> {
  return {
    output: { answer: "yes" },
    contextSnapshotId: "snapshot-1",
    provider: "anthropic",
    company: "anthropic",
    route,
    modelId: model.modelId,
    providerRequestId: `${route}-request`,
    structuredOutputSha256: "a".repeat(64),
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    cost: { estimatedUsd: null },
  };
}

function adapter(
  route: ProviderRoute,
  outcome: Error | "ok",
): RouteAdapter & {
  execute: ReturnType<typeof vi.fn>;
} {
  return {
    provider: "anthropic",
    route,
    execute: vi.fn(async () => {
      if (outcome !== "ok") throw outcome;
      return response(route);
    }),
  };
}

const failure = (status: number) =>
  new ProviderAdapterError("anthropic", status >= 500 ? "transient" : "unknown", "failed", {
    status,
  });

describe("createRoutedAdapter", () => {
  it("answers from the primary route and never calls the fallback when it succeeds", async () => {
    const primary = adapter("vertex-ai", "ok");
    const fallback = adapter("anthropic-api", "ok");

    const result = await createRoutedAdapter({ primary, fallback }).execute(request);

    expect(result.route).toBe("vertex-ai");
    expect(result.routeFallback).toBeUndefined();
    expect(fallback.execute).not.toHaveBeenCalled();
  });

  it.each([
    ["model-not-offered", failure(404)],
    [
      "model-not-offered",
      new ProviderAdapterError("anthropic", "invalid-request", "refused", {
        diagnostics: [{ code: "vertex_model_not_offered", path: "model" }],
      }),
    ],
    ["route-unavailable", failure(503)],
    ["route-unavailable", new ProviderAdapterError("anthropic", "timeout", "slow")],
    ["route-unavailable", new ProviderAdapterError("anthropic", "rate-limit", "busy")],
  ])("falls back on %s and records where the call came from", async (cause, error) => {
    const primary = adapter("vertex-ai", error);
    const fallback = adapter("anthropic-api", "ok");

    const result = await createRoutedAdapter({ primary, fallback }).execute(request);

    expect(result).toMatchObject({
      company: "anthropic",
      modelId: model.modelId,
      route: "anthropic-api",
      routeFallback: { from: "vertex-ai", cause },
    });
    expect(fallback.execute).toHaveBeenCalledWith(request);
  });

  it("keeps the primary's error when the policy gives no fallback", async () => {
    const error = failure(503);
    const primary = adapter("vertex-ai", error);

    await expect(createRoutedAdapter({ primary }).execute(request)).rejects.toBe(error);
  });

  it.each([
    ["an authentication error", new ProviderAdapterError("anthropic", "authentication", "no")],
    ["a policy refusal", new ProviderAdapterError("anthropic", "policy", "no")],
    ["an invalid response", new ProviderAdapterError("anthropic", "invalid-response", "no")],
    [
      "a quota or budget exhaustion",
      new ProviderAdapterError("anthropic", "quota-exhausted", "no"),
    ],
    ["a cancellation", new ProviderAdapterError("anthropic", "cancelled", "no")],
    ["a bad request", failure(400)],
  ])("never falls back on %s", async (_label, error) => {
    const primary = adapter("vertex-ai", error);
    const fallback = adapter("anthropic-api", "ok");

    await expect(createRoutedAdapter({ primary, fallback }).execute(request)).rejects.toBe(error);
    expect(fallback.execute).not.toHaveBeenCalled();
  });

  it("does not fall back once the request is aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const error = failure(503);
    const primary = adapter("vertex-ai", error);
    const fallback = adapter("anthropic-api", "ok");

    await expect(
      createRoutedAdapter({ primary, fallback }).execute({ ...request, signal: controller.signal }),
    ).rejects.toBe(error);
    expect(fallback.execute).not.toHaveBeenCalled();
  });

  it("refuses a fallback for another company or on the same route", () => {
    const primary = adapter("vertex-ai", "ok");
    expect(() =>
      createRoutedAdapter({
        primary,
        fallback: { ...adapter("openai-api", "ok"), provider: "openai" },
      }),
    ).toThrow(RoutePolicyError);
    expect(() => createRoutedAdapter({ primary, fallback: adapter("vertex-ai", "ok") })).toThrow(
      RoutePolicyError,
    );
  });
});
