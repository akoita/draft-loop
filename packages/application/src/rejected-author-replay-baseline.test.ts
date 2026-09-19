import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { summarizeRejectedAuthorReplays } from "./rejected-author-replay-summary.js";

const fixtureText = readFileSync(
  new URL("../fixtures/rejected-author-replay/baseline.json", import.meta.url),
  "utf8",
);

describe("sanitized rejected-author replay baseline", () => {
  it("records the deterministic aggregate without disclosing fixture content or identity", () => {
    const result = summarizeRejectedAuthorReplays(JSON.parse(fixtureText));

    expect(result).toEqual({
      total: 3,
      accepted: 2,
      rejected: 1,
      failureStages: [{ value: "factual-invariant-rejection", count: 1 }],
      diagnosticCodes: [{ value: "factual_invariant_violation", count: 1 }],
    });

    const serialized = JSON.stringify(result);
    for (const privateFixtureValue of [
      "999",
      "regulated industries",
      "fixture://sanitized",
      "sanitized-workspace",
      "sanitized-accepted-case",
      "sanitized-inflated-case",
      "sanitized-coverage-case",
      "local",
      "sanitized-fixture",
    ]) {
      expect(serialized).not.toContain(privateFixtureValue);
    }
  });

  it("contains only invented local fixture identities", () => {
    expect(fixtureText).not.toContain("anthropic");
    expect(fixtureText).not.toContain("openai");
    expect(fixtureText).not.toContain("/private/");
    expect(fixtureText).not.toContain("@draft-loop");
  });
});
