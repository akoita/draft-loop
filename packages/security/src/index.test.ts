import { describe, expect, it } from "vitest";

import {
  createOperationalLogEvent,
  defaultRetentionPolicy,
  redactJson,
  redactText,
} from "./index.js";

describe("privacy guardrails", () => {
  it("redacts credential-shaped text without returning the original secret", () => {
    const result = redactText(
      "api_key=sk-test_1234567890123456 and Bearer abcdefghijklmnopqrstuvwxyz",
    );

    expect(result.redacted).toBe(true);
    expect(result.matchCount).toBe(2);
    expect(result.ruleIds).toEqual(["credential-assignment", "bearer-token"]);
    expect(result.value).not.toContain("sk-test_1234567890123456");
    expect(result.value).not.toContain("abcdefghijklmnopqrstuvwxyz");
  });

  it("supports explicit application redaction rules for confidential terms", () => {
    const result = redactJson(
      {
        source: "Confidential employer project Atlas",
        nested: ["keep this structure", "Project Atlas"],
      },
      [
        {
          id: "employer-project",
          pattern: /Project Atlas/giu,
          replacement: "[REDACTED:EMPLOYER_PROJECT]",
          description: "User-selected confidential employer term",
        },
      ],
    );

    expect(JSON.stringify(result)).not.toContain("Project Atlas");
    expect(result).toEqual({
      source: "Confidential employer [REDACTED:EMPLOYER_PROJECT]",
      nested: ["keep this structure", "[REDACTED:EMPLOYER_PROJECT]"],
    });
  });

  it("defaults provider retention to not allowed", () => {
    expect(defaultRetentionPolicy).toEqual({
      localSourceRetention: "until-deleted",
      runHistoryRetention: "until-deleted",
      providerRetention: "not-allowed",
    });
  });

  it("keeps operational events to an allowlisted, content-free shape", () => {
    const event = createOperationalLogEvent({
      event: "provider.request",
      level: "info",
      timestamp: "2026-08-12T10:00:00.000Z",
      provider: "anthropic",
      modelId: "claude-test",
      status: "succeeded",
      inputTokens: 12,
      response: "raw provider response must not be retained",
      prompt: "raw prompt must not be retained",
      message: "candidate source must not be retained",
    });

    expect(event).toEqual({
      event: "provider.request",
      level: "info",
      timestamp: "2026-08-12T10:00:00.000Z",
      contentRedacted: true,
      provider: "anthropic",
      modelId: "claude-test",
      status: "succeeded",
      inputTokens: 12,
    });
    expect(JSON.stringify(event)).not.toContain("raw provider response");
    expect(JSON.stringify(event)).not.toContain("raw prompt");
  });

  it("rejects unbounded event content in identifier fields", () => {
    expect(() =>
      createOperationalLogEvent({
        event: "provider request with source text",
        timestamp: "2026-08-12T10:00:00.000Z",
      }),
    ).toThrow("bounded identifier");
  });
});
