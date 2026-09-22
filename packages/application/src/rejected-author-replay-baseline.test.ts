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
const intentText = readFileSync(
  new URL("../fixtures/rejected-author-replay/h461-intent.json", import.meta.url),
  "utf8",
);
const h466IntentText = readFileSync(
  new URL("../fixtures/rejected-author-replay/h466-intent.json", import.meta.url),
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

interface ReplayIntent {
  readonly executionId: string;
  readonly hypothesis: "A" | "B" | "D";
  readonly intent: "supported" | "control";
}

interface SingleWordNameIntent {
  readonly executionId: string;
  readonly intent: "supported" | "control";
}

const captures = JSON.parse(fixtureText) as readonly ReplayCapture[];
const expectations = JSON.parse(expectationText) as readonly ReplayExpectation[];
const intents = JSON.parse(intentText) as readonly ReplayIntent[];
const h466Intents = JSON.parse(h466IntentText) as readonly SingleWordNameIntent[];

function replayById(executionId: string) {
  const capture = captures.find(
    (candidate) => candidate.validationInputs.executionId === executionId,
  );
  if (capture === undefined) throw new Error(`missing replay case ${executionId}`);
  return replayRejectedAuthorCapture(capture);
}

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
      total: 34,
      accepted: 17,
      rejected: 17,
      failureStages: [
        { value: "artifact-schema-validation", count: 1 },
        { value: "factual-invariant-rejection", count: 16 },
      ],
      diagnosticCodes: [
        { value: "custom", count: 1 },
        { value: "factual_invariant_violation", count: 12 },
        { value: "substantive_text_uncovered", count: 3 },
        { value: "unsupported_claim", count: 4 },
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
      "sanitized-h461",
      "Brightfield Logistics",
      "Harbor Lane Software",
      "PostgreSQL",
      "sanitized-h466",
      "Kafka",
      "Globex",
      "Berlin",
    ]) {
      expect(serialized).not.toContain(privateFixtureValue);
    }
  });

  it("classifies every #461 hypothesis case exactly once as supported or control", () => {
    const h461Ids = captures
      .map((capture) => capture.validationInputs.executionId)
      .filter((executionId) => executionId.startsWith("sanitized-h461-"));

    expect(intents.map((intent) => intent.executionId)).toEqual(h461Ids);
    for (const intent of intents) {
      expect(intent.executionId.endsWith("-control"), intent.executionId).toBe(
        intent.intent === "control",
      );
      expect(
        intent.executionId.startsWith(`sanitized-h461-${intent.hypothesis.toLowerCase()}-`),
        intent.executionId,
      ).toBe(true);
    }
  });

  it("rejects every changed-fact control case", () => {
    const controls = intents.filter((intent) => intent.intent === "control");

    expect(controls).toHaveLength(10);
    for (const control of controls) {
      expect(replayById(control.executionId).status, control.executionId).toBe("rejected");
    }
  });

  it("records the supported hypothesis cases the validator currently rejects", () => {
    const rejectedSupported = intents
      .filter((intent) => intent.intent === "supported")
      .filter((intent) => replayById(intent.executionId).status === "rejected")
      .map((intent) => intent.executionId);

    // Candidate false rejections. Change this list only deliberately, with the
    // validator or author-guidance change that explains the difference.
    expect(rejectedSupported).toEqual([
      "sanitized-h461-a-joining-words",
      "sanitized-h461-d-per-value-claims",
    ]);
  });

  it("classifies every #466 single-word name case exactly once as supported or control", () => {
    const h466Ids = captures
      .map((capture) => capture.validationInputs.executionId)
      .filter((executionId) => executionId.startsWith("sanitized-h466-"));

    expect(h466Intents.map((intent) => intent.executionId)).toEqual(h466Ids);
    for (const intent of h466Intents) {
      expect(intent.executionId.endsWith("-control"), intent.executionId).toBe(
        intent.intent === "control",
      );
    }
  });

  it("accepts every #466 case whose single-word name appears in the cited evidence", () => {
    const supported = h466Intents.filter((intent) => intent.intent === "supported");

    expect(supported).toHaveLength(2);
    for (const intent of supported) {
      expect(replayById(intent.executionId).status, intent.executionId).toBe("accepted");
    }
  });

  it("records the unsupported single-word name controls the validator currently accepts", () => {
    const acceptedControls = h466Intents
      .filter((intent) => intent.intent === "control")
      .filter((intent) => replayById(intent.executionId).status === "accepted")
      .map((intent) => intent.executionId);

    // Known gaps: a single capitalised name outside an "at"/"for" phrase is not
    // a protected value. Change this list only deliberately, with the validator
    // change that explains the difference.
    expect(acceptedControls).toEqual([
      "sanitized-h466-tool-sentence-control",
      "sanitized-h466-tool-list-control",
      "sanitized-h466-organisation-sentence-control",
      "sanitized-h466-place-sentence-control",
    ]);
  });

  it("contains only invented local fixture identities", () => {
    expect(fixtureText).not.toContain("anthropic");
    expect(fixtureText).not.toContain("openai");
    expect(fixtureText).not.toContain("/private/");
    expect(fixtureText).not.toContain("@draft-loop");
    expect(expectationText).not.toContain("fixture://");
    expect(intentText).not.toContain("fixture://");
    expect(h466IntentText).not.toContain("fixture://");
  });
});
