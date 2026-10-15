import type { ModelSelection } from "@draft-loop/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AnthropicClaudeUserSessionAdapter,
  type ModelRequest,
  OpenAICodexUserSessionAdapter,
  ProviderAdapterError,
} from "./index.js";
import { isUsageLimitText, usageLimitResetsAt } from "./usage-limit.js";

const now = Date.parse("2026-10-16T12:00:00.000Z");
const anthropicModel: ModelSelection = {
  company: "anthropic",
  modelId: "claude-exact",
  role: "author",
  promptTemplateVersion: "author-v1",
};
const openAIModel: ModelSelection = {
  company: "openai",
  modelId: "gpt-exact",
  role: "critic",
  promptTemplateVersion: "critic-v1",
};

function request(model: ModelSelection): ModelRequest {
  return {
    contextSnapshotId: "snapshot-usage-limit",
    model,
    systemPrompt: "Return JSON only.",
    input: { question: "answer?" },
    outputSchema: {
      type: "object",
      properties: { answer: { type: "string" } },
      required: ["answer"],
      additionalProperties: false,
    },
    outputName: "answer_schema",
    maxOutputTokens: 20,
    dataPolicy: {
      allowTransmission: true,
      allowedCompanies: ["anthropic", "openai"],
      sensitiveData: false,
      sensitiveDataAcknowledged: false,
    },
  };
}

async function claudeError(stdout: string, stderr = "", exitCode = 1) {
  const adapter = new AnthropicClaudeUserSessionAdapter({
    configuredModel: anthropicModel,
    runner: async () => ({ exitCode, stdout, stderr }),
  });
  return adapter.execute(request(anthropicModel)).then(
    () => {
      throw new Error("expected rejection");
    },
    (error: unknown) => error as ProviderAdapterError,
  );
}

async function codexError(stdout: string, stderr: string) {
  const adapter = new OpenAICodexUserSessionAdapter({
    configuredModel: openAIModel,
    runner: async () => ({ exitCode: 1, stdout, stderr }),
  });
  return adapter.execute(request(openAIModel)).then(
    () => {
      throw new Error("expected rejection");
    },
    (error: unknown) => error as ProviderAdapterError,
  );
}

describe("subscription usage limit recognition", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("recognises the Claude CLI result envelope and reads a validated reset time", async () => {
    const resetEpoch = Math.floor(now / 1000) + 3 * 3600;
    const error = await claudeError(
      JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: true,
        api_error_status: 429,
        result: `Claude AI usage limit reached|${resetEpoch}`,
      }),
    );
    expect(error).toBeInstanceOf(ProviderAdapterError);
    expect(error).toMatchObject({
      code: "usage-limit",
      provider: "anthropic",
      retryable: false,
      usageLimitResetsAt: new Date(resetEpoch * 1000).toISOString(),
    });
    expect(error.message).not.toContain("Claude AI");
  });

  it("recognises a Claude limit with no status and no reset time", async () => {
    const error = await claudeError(
      JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: true,
        result: "5-hour limit reached ∙ resets 3pm",
      }),
    );
    expect(error).toMatchObject({ code: "usage-limit", usageLimitResetsAt: null });
  });

  it("recognises Claude limit text on a failed process", async () => {
    const error = await claudeError("", "You've hit your limit · resets 3pm");
    expect(error).toMatchObject({ code: "usage-limit", provider: "anthropic" });
  });

  it("recognises the Codex CLI usage-limit message without parsing its free-text time", async () => {
    const error = await codexError(
      "",
      "You've hit your usage limit. Upgrade to Pro, or try again at Oct 17th, 2026 3:00 PM.",
    );
    expect(error).toMatchObject({
      code: "usage-limit",
      provider: "openai",
      usageLimitResetsAt: null,
    });
    expect(error.message).not.toContain("Upgrade");
  });

  it("keeps API-credit exhaustion and rate limits distinct from a usage limit", async () => {
    expect(await codexError("", "insufficient_quota")).toMatchObject({ code: "quota-exhausted" });
    expect(await codexError("", "quota exceeded for this usage limit")).toMatchObject({
      code: "quota-exhausted",
    });
    expect(await codexError("", "429 Too Many Requests")).toMatchObject({ code: "rate-limit" });
  });

  it("matches only the known indicators", () => {
    expect(isUsageLimitText("Weekly limit reached")).toBe(true);
    expect(isUsageLimitText("rate limit reached")).toBe(false);
    expect(isUsageLimitText("insufficient_quota usage limit")).toBe(false);
    expect(isUsageLimitText("")).toBe(false);
  });

  it("accepts only a bounded ten-digit epoch after the limit text", () => {
    const soon = Math.floor(now / 1000) + 60;
    expect(usageLimitResetsAt(`usage limit reached|${soon}`)).toBe(
      new Date(soon * 1000).toISOString(),
    );
    expect(usageLimitResetsAt(`usage limit reached|${soon - 3600}`)).toBeUndefined();
    expect(usageLimitResetsAt(`usage limit reached|${soon + 40 * 86_400}`)).toBeUndefined();
    expect(usageLimitResetsAt(`usage limit reached|${soon}0`)).toBeUndefined();
    expect(usageLimitResetsAt("usage limit reached|soon")).toBeUndefined();
    expect(usageLimitResetsAt(`resets ${soon}`)).toBeUndefined();
  });
});
