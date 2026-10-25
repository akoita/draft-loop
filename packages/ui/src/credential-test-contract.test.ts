import { describe, expect, it } from "vitest";

import { normalizeCredentialTestResult } from "./credential-test-contract.js";

const valid = {
  provider: "openai",
  outcome: "limited",
  models: ["gpt-fictional"],
  providerCode: "insufficient_quota",
  checkedAt: "2026-10-24T09:30:00.000Z",
};

describe("normalizeCredentialTestResult", () => {
  it("accepts a well-formed answer", () => {
    expect(normalizeCredentialTestResult(valid)).toEqual(valid);
  });

  it("refuses an answer that carries anything else, such as a key", () => {
    expect(
      normalizeCredentialTestResult({ ...valid, apiKey: "sk-proj-fictional" }),
    ).toBeUndefined();
  });

  it.each([
    ["an unknown provider", { provider: "mistral" }],
    ["an unknown outcome", { outcome: "maybe" }],
    ["a provider message instead of a token", { providerCode: "You exceeded your quota." }],
    ["a token outside a limit", { outcome: "rejected" }],
    [
      "a missing model without its name",
      { outcome: "no-model-access", providerCode: null, models: [] },
    ],
    ["more models than a pair has", { models: ["a", "b", "c"] }],
    ["a malformed time", { checkedAt: "later" }],
  ])("refuses %s", (_label, change) => {
    expect(normalizeCredentialTestResult({ ...valid, ...change })).toBeUndefined();
  });
});
