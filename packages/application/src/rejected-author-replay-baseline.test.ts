import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { replayRejectedAuthorCapture } from "./rejected-author-replay.js";
import { summarizeRejectedAuthorReplays } from "./rejected-author-replay-summary.js";

const fixtureText = readFileSync(
  new URL("../fixtures/rejected-author-replay/baseline.json", import.meta.url),
  "utf8",
);
const expectationText = readFileSync(
  new URL("../fixtures/rejected-author-replay/expectations.json", import.meta.url),
  "utf8",
);

interface ReplayCapture {
  readonly validationInputs: { readonly executionId: string };
}

interface ReplayExpectation {
  readonly executionId: string;
  readonly status: "accepted" | "rejected";
  readonly diagnosticCodes: readonly string[];
}

const captures = JSON.parse(fixtureText) as readonly ReplayCapture[];
const expectations = JSON.parse(expectationText) as readonly ReplayExpectation[];

describe("sanitized rejected-author replay baseline", () => {
  it("declares and verifies one structural expectation for every frozen case", () => {
    expect(captures.map((capture) => capture.validationInputs.executionId)).toEqual(
      expectations.map((expectation) => expectation.executionId),
    );

    for (const [index, expectation] of expectations.entries()) {
      const result = replayRejectedAuthorCapture(captures[index]);
      expect(result.status, expectation.executionId).toBe(expectation.status);
      expect(
        result.status === "rejected"
          ? [...new Set(result.diagnostics.map((diagnostic) => diagnostic.code))].sort()
          : [],
        expectation.executionId,
      ).toEqual([...expectation.diagnosticCodes].sort());
    }
  });

  it("records the deterministic aggregate without disclosing fixture content or identity", () => {
    const result = summarizeRejectedAuthorReplays(captures);

    expect(result).toEqual({
      total: 6,
      accepted: 2,
      rejected: 4,
      failureStages: [
        { value: "artifact-schema-validation", count: 1 },
        { value: "factual-invariant-rejection", count: 3 },
      ],
      diagnosticCodes: [
        { value: "custom", count: 1 },
        { value: "factual_invariant_violation", count: 2 },
        { value: "substantive_text_uncovered", count: 1 },
      ],
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
      "25 percent",
      "25%",
      "delivery team",
      "sanitized-supported-paraphrase-case",
      "sanitized-unsupported-evidence-case",
      "sanitized-mixed-coverage-case",
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
    expect(expectationText).not.toContain("fixture://");
  });
});
