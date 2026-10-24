import { describe, expect, it, vi } from "vitest";

import { checkProviderApiKey } from "./index.js";

const anthropicKey = "sk-ant-api03-fictional-test-key";
const openaiKey = "sk-proj-fictional-test-key";

/** A `fetch` that never touches a socket and answers with one scripted status. */
function scriptedFetch(status: number, body: unknown = {}) {
  return vi.fn(
    async () =>
      ({
        ok: status >= 200 && status < 300,
        status,
        headers: new Headers(),
        text: async () => JSON.stringify(body),
      }) as unknown as Response,
  );
}

function onlyRequest(fetchImpl: ReturnType<typeof scriptedFetch>): {
  url: string;
  init: RequestInit;
} {
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
  return { url, init };
}

describe("checkProviderApiKey", () => {
  it("looks up the Anthropic model with a GET and reports a working key", async () => {
    const fetchImpl = scriptedFetch(200, { id: "claude-fictional-5" });

    const result = await checkProviderApiKey({
      provider: "anthropic",
      apiKey: anthropicKey,
      model: "claude-fictional-5",
      fetch: fetchImpl as unknown as typeof fetch,
    });

    expect(result).toEqual({ provider: "anthropic", outcome: "works", providerCode: null });
    const { url, init } = onlyRequest(fetchImpl);
    expect(url).toBe("https://api.anthropic.com/v1/models/claude-fictional-5");
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
    expect(init.headers).toMatchObject({
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
    });
  });

  it("looks up the OpenAI model with a bearer key and never calls a generation endpoint", async () => {
    const fetchImpl = scriptedFetch(200, { id: "gpt-fictional" });

    await checkProviderApiKey({
      provider: "openai",
      apiKey: openaiKey,
      model: "gpt-fictional",
      fetch: fetchImpl as unknown as typeof fetch,
    });

    const { url, init } = onlyRequest(fetchImpl);
    expect(url).toBe("https://api.openai.com/v1/models/gpt-fictional");
    expect(url).not.toMatch(/responses|completions|messages|embeddings/u);
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
    expect(init.headers).toMatchObject({ authorization: `Bearer ${openaiKey}` });
  });

  it("lists models when no model is named, so only the key is checked", async () => {
    const anthropicFetch = scriptedFetch(200, { data: [] });
    const openaiFetch = scriptedFetch(200, { data: [] });

    await checkProviderApiKey({
      provider: "anthropic",
      apiKey: anthropicKey,
      fetch: anthropicFetch as unknown as typeof fetch,
    });
    await checkProviderApiKey({
      provider: "openai",
      apiKey: openaiKey,
      fetch: openaiFetch as unknown as typeof fetch,
    });

    expect(onlyRequest(anthropicFetch).url).toBe("https://api.anthropic.com/v1/models?limit=1");
    expect(onlyRequest(openaiFetch).url).toBe("https://api.openai.com/v1/models");
  });

  it.each([
    [401, "rejected"],
    [403, "no-model-access"],
    [404, "no-model-access"],
    [500, "unreachable"],
    [400, "unreachable"],
  ] as const)("classifies status %i as %s", async (status, outcome) => {
    const result = await checkProviderApiKey({
      provider: "openai",
      apiKey: openaiKey,
      model: "gpt-fictional",
      fetch: scriptedFetch(status, {
        error: { message: `Incorrect API key provided: ${openaiKey}`, code: "invalid_api_key" },
      }) as unknown as typeof fetch,
    });

    expect(result).toEqual({ provider: "openai", outcome, providerCode: null });
    expect(JSON.stringify(result)).not.toContain(openaiKey);
  });

  it("keeps the provider's short token for a quota or rate limit", async () => {
    const quota = await checkProviderApiKey({
      provider: "openai",
      apiKey: openaiKey,
      model: "gpt-fictional",
      fetch: scriptedFetch(429, {
        error: { message: "You exceeded your current quota.", code: "insufficient_quota" },
      }) as unknown as typeof fetch,
    });
    const rate = await checkProviderApiKey({
      provider: "anthropic",
      apiKey: anthropicKey,
      model: "claude-fictional-5",
      fetch: scriptedFetch(429, {
        type: "error",
        error: { type: "rate_limit_error", message: "Number of requests has exceeded your limit." },
      }) as unknown as typeof fetch,
    });

    expect(quota).toEqual({
      provider: "openai",
      outcome: "limited",
      providerCode: "insufficient_quota",
    });
    expect(rate).toEqual({
      provider: "anthropic",
      outcome: "limited",
      providerCode: "rate_limit_error",
    });
  });

  it("drops a limit token that is not one short safe word", async () => {
    const result = await checkProviderApiKey({
      provider: "openai",
      apiKey: openaiKey,
      fetch: scriptedFetch(429, {
        error: { code: "<script>alert(1)</script>", type: "x".repeat(80) },
      }) as unknown as typeof fetch,
    });

    expect(result).toEqual({ provider: "openai", outcome: "limited", providerCode: null });
  });

  it("reports a network failure as not checked, never as rejected", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });

    const result = await checkProviderApiKey({
      provider: "anthropic",
      apiKey: anthropicKey,
      model: "claude-fictional-5",
      fetch: fetchImpl as unknown as typeof fetch,
    });

    expect(result).toEqual({ provider: "anthropic", outcome: "unreachable", providerCode: null });
  });

  it("gives up after the timeout and reports the key as not checked", async () => {
    const fetchImpl = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );

    const result = await checkProviderApiKey({
      provider: "openai",
      apiKey: openaiKey,
      model: "gpt-fictional",
      timeoutMs: 5,
      fetch: fetchImpl as unknown as typeof fetch,
    });

    expect(result.outcome).toBe("unreachable");
  });

  it("encodes the model id into the lookup path", async () => {
    const fetchImpl = scriptedFetch(200);

    await checkProviderApiKey({
      provider: "openai",
      apiKey: openaiKey,
      model: "ft:gpt-fictional/../admin",
      fetch: fetchImpl as unknown as typeof fetch,
    });

    expect(onlyRequest(fetchImpl).url).toBe(
      "https://api.openai.com/v1/models/ft%3Agpt-fictional%2F..%2Fadmin",
    );
  });
});
