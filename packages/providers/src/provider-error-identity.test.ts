import Anthropic from "@anthropic-ai/sdk";
import type { ModelSelection } from "@draft-loop/domain";
import OpenAI from "openai";
import { describe, expect, it } from "vitest";

import {
  AnthropicAdapter,
  type AnthropicClient,
  type ModelRequest,
  normalizeProviderError,
  OpenAIAdapter,
  type OpenAIClient,
  ProviderAdapterError,
  providerErrorIdentity,
} from "./index.js";

/** Synthetic text standing in for a prompt a provider quotes back in its error message. */
const marker = "SYNTHETIC-CANDIDATE-TEXT";

const critic: ModelSelection = {
  company: "openai",
  modelId: "gpt-test-exact",
  role: "critic",
  promptTemplateVersion: "critic-v1",
};

const author: ModelSelection = {
  company: "anthropic",
  modelId: "claude-test-exact",
  role: "author",
  promptTemplateVersion: "author-v1",
};

function request(model: ModelSelection): ModelRequest {
  return {
    contextSnapshotId: "snapshot-1",
    model,
    systemPrompt: "Return the requested data as JSON.",
    input: { draft: marker },
    outputSchema: { type: "object" },
    outputName: "answer_schema",
    dataPolicy: {
      allowTransmission: true,
      allowedCompanies: ["anthropic", "openai"],
      sensitiveData: false,
      sensitiveDataAcknowledged: false,
    },
  };
}

function failingOpenAi(error: unknown): OpenAIClient {
  return { responses: { create: async () => Promise.reject(error) } };
}

function failingAnthropic(error: unknown): AnthropicClient {
  return { messages: { create: () => Promise.reject(error) as never } } as AnthropicClient;
}

async function rejection(promise: Promise<unknown>): Promise<ProviderAdapterError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (!(error instanceof ProviderAdapterError)) throw new Error("Expected a provider error.");
  return error;
}

describe("a failed provider call's identity", () => {
  it("names the OpenAI route, status and error tokens, never the message", async () => {
    const sdkError = new OpenAI.AuthenticationError(
      401,
      {
        message: `Incorrect API key near ${marker}`,
        type: "invalid_request_error",
        code: "invalid_api_key",
      },
      undefined,
      new Headers(),
    );
    const adapter = new OpenAIAdapter(failingOpenAi(sdkError), {
      configuredModel: critic,
      retry: { maxRetries: 0 },
    });

    const error = await rejection(adapter.execute(request(critic)));

    expect(error).toMatchObject({
      provider: "openai",
      code: "authentication",
      route: "openai-api",
      status: 401,
      providerErrorType: "invalid_request_error",
      providerErrorCode: "invalid_api_key",
      rateLimit: null,
    });
    expect(error.message).not.toContain(marker);
  });

  it("says which OpenAI limit ran out and when to retry", async () => {
    const sdkError = new OpenAI.RateLimitError(
      429,
      { message: marker, type: "tokens", code: "rate_limit_exceeded" },
      undefined,
      new Headers({
        "x-ratelimit-remaining-requests": "499",
        "x-ratelimit-remaining-tokens": "0",
        "retry-after": "20",
      }),
    );

    expect(normalizeProviderError("openai", sdkError, "openai-api")).toMatchObject({
      code: "rate-limit",
      route: "openai-api",
      providerErrorType: "tokens",
      providerErrorCode: "rate_limit_exceeded",
      rateLimit: "tokens",
      retryAfterSeconds: 20,
      // The retry cap applies only to the wait, not to what the provider asked for.
      retryAfterMs: 20_000,
    });
  });

  it.each([
    ["its code", { type: "insufficient_quota", code: "insufficient_quota" }],
    ["only its type", { type: "insufficient_quota", code: null }],
  ])("names a spent OpenAI credit when %s says so, never a rate limit", (_label, body) => {
    const sdkError = new OpenAI.RateLimitError(
      429,
      {
        message: "You exceeded your current quota, please check your plan and billing details.",
        param: null,
        ...body,
      },
      undefined,
      new Headers({ "x-request-id": "req-synthetic" }),
    );

    expect(normalizeProviderError("openai", sdkError, "openai-api")).toMatchObject({
      code: "quota-exhausted",
      status: 429,
      providerErrorType: "insufficient_quota",
    });
  });

  it("names Claude's limit and error type on its route", async () => {
    const sdkError = new Anthropic.RateLimitError(
      429,
      { type: "error", error: { type: "rate_limit_error", message: marker } },
      undefined,
      new Headers({
        "anthropic-ratelimit-requests-remaining": "10",
        "anthropic-ratelimit-input-tokens-remaining": "0",
        "retry-after": "90",
      }),
      "rate_limit_error",
    );
    const adapter = new AnthropicAdapter(failingAnthropic(sdkError), {
      configuredModel: author,
      route: "vertex-ai",
      retry: { maxRetries: 0 },
    });

    const error = await rejection(adapter.execute(request(author)));

    expect(error).toMatchObject({
      code: "rate-limit",
      route: "vertex-ai",
      status: 429,
      providerErrorType: "rate_limit_error",
      rateLimit: "input-tokens",
      retryAfterSeconds: 90,
      retryAfterMs: 60_000,
    });
    expect(JSON.stringify({ ...error, message: error.message })).not.toContain(marker);
  });

  it("keeps a route already named and adds the adapter's to an error that has none", () => {
    const named = new ProviderAdapterError("anthropic", "authentication", "No key.", {
      route: "anthropic-api",
    });
    const unnamed = new ProviderAdapterError("anthropic", "invalid-response", "No output.", {
      retryable: false,
      diagnostics: [{ code: "missing_text", path: "content" }],
    });

    expect(normalizeProviderError("anthropic", named, "vertex-ai")).toBe(named);
    expect(normalizeProviderError("anthropic", unnamed, "vertex-ai")).toMatchObject({
      code: "invalid-response",
      retryable: false,
      route: "vertex-ai",
      diagnostics: [{ code: "missing_text", path: "content" }],
    });
  });

  it("drops a type or code that is not a short token, and headers that are not numbers", () => {
    expect(
      providerErrorIdentity({
        status: 429,
        type: `rate limit reached for ${marker}`,
        code: "x".repeat(65),
        headers: { "x-ratelimit-remaining-requests": "none", "retry-after": marker },
      }),
    ).toEqual({});
  });
});
