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
const h469IntentText = readFileSync(
  new URL("../fixtures/rejected-author-replay/h469-intent.json", import.meta.url),
  "utf8",
);
const h470IntentText = readFileSync(
  new URL("../fixtures/rejected-author-replay/h470-intent.json", import.meta.url),
  "utf8",
);
const h471IntentText = readFileSync(
  new URL("../fixtures/rejected-author-replay/h471-intent.json", import.meta.url),
  "utf8",
);
const h480IntentText = readFileSync(
  new URL("../fixtures/rejected-author-replay/h480-intent.json", import.meta.url),
  "utf8",
);
const h481IntentText = readFileSync(
  new URL("../fixtures/rejected-author-replay/h481-intent.json", import.meta.url),
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
const h469Intents = JSON.parse(h469IntentText) as readonly SingleWordNameIntent[];
const h470Intents = JSON.parse(h470IntentText) as readonly SingleWordNameIntent[];
const h471Intents = JSON.parse(h471IntentText) as readonly SingleWordNameIntent[];
const h480Intents = JSON.parse(h480IntentText) as readonly SingleWordNameIntent[];
const h481Intents = JSON.parse(h481IntentText) as readonly SingleWordNameIntent[];

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
      total: 64,
      accepted: 30,
      rejected: 34,
      failureStages: [
        { value: "artifact-schema-validation", count: 1 },
        { value: "factual-invariant-rejection", count: 33 },
      ],
      diagnosticCodes: [
        { value: "custom", count: 1 },
        { value: "factual_invariant_violation", count: 21 },
        { value: "substantive_text_uncovered", count: 9 },
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
      "sanitized-h469",
      "Redis",
      "deployment dashboard",
      "sanitized-h470",
      "logistics software",
      "migration projects",
      "on-call rotations",
      "sanitized-h471",
      "Statistics",
      "go live",
      "sanitized-h480",
      "Platform migrations",
      "Northwind Freight",
      "Pulsar",
      "billing platform",
      "employer of record",
      "sanitized-h481",
      "Ada Example",
      "ada@example.com",
      "Lisbon",
      "Porto",
      "Tooling",
      "12,000",
      "2019 – 2023",
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
    // None since #471 relates claims made only of short names such as "Go".
    expect(rejectedSupported).toEqual([]);
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

    // Known gaps: none since #469 checks capitalised single words against the
    // cited evidence. Change this list only deliberately, with the validator
    // change that explains the difference.
    expect(acceptedControls).toEqual([]);
  });

  it("classifies every #469 single-word name case exactly once as supported or control", () => {
    const h469Ids = captures
      .map((capture) => capture.validationInputs.executionId)
      .filter((executionId) => executionId.startsWith("sanitized-h469-"));

    expect(h469Intents.map((intent) => intent.executionId)).toEqual(h469Ids);
    for (const intent of h469Intents) {
      expect(intent.executionId.endsWith("-control"), intent.executionId).toBe(
        intent.intent === "control",
      );
    }
  });

  it("accepts every #469 supported capitalised-word case", () => {
    const supported = h469Intents.filter((intent) => intent.intent === "supported");

    expect(supported).toHaveLength(6);
    for (const intent of supported) {
      expect(replayById(intent.executionId).status, intent.executionId).toBe("accepted");
    }
  });

  it("rejects every #469 single-word name control", () => {
    const controls = h469Intents.filter((intent) => intent.intent === "control");

    expect(controls).toHaveLength(1);
    for (const control of controls) {
      expect(replayById(control.executionId).status, control.executionId).toBe("rejected");
    }
  });

  it("classifies every #470 joining-word case exactly once as supported or control", () => {
    const h470Ids = captures
      .map((capture) => capture.validationInputs.executionId)
      .filter((executionId) => executionId.startsWith("sanitized-h470-"));

    expect(h470Intents.map((intent) => intent.executionId)).toEqual(h470Ids);
    for (const intent of h470Intents) {
      expect(intent.executionId.endsWith("-control"), intent.executionId).toBe(
        intent.intent === "control",
      );
    }
  });

  it("accepts every #470 summary joined by a listed joining phrase", () => {
    const supported = h470Intents.filter((intent) => intent.intent === "supported");

    expect(supported).toHaveLength(2);
    for (const intent of supported) {
      expect(replayById(intent.executionId).status, intent.executionId).toBe("accepted");
    }
  });

  it("rejects every #470 joining-word control as uncovered text", () => {
    const controls = h470Intents.filter((intent) => intent.intent === "control");

    expect(controls).toHaveLength(2);
    for (const control of controls) {
      const result = replayById(control.executionId);
      expect(result.status, control.executionId).toBe("rejected");
      expect(
        result.status === "rejected" ? result.diagnostics.map((diagnostic) => diagnostic.code) : [],
        control.executionId,
      ).toContain("substantive_text_uncovered");
    }
  });

  it("classifies every #471 short-name case exactly once as supported or control", () => {
    const h471Ids = captures
      .map((capture) => capture.validationInputs.executionId)
      .filter((executionId) => executionId.startsWith("sanitized-h471-"));

    expect(h471Intents.map((intent) => intent.executionId)).toEqual(h471Ids);
    for (const intent of h471Intents) {
      expect(intent.executionId.endsWith("-control"), intent.executionId).toBe(
        intent.intent === "control",
      );
    }
  });

  it("accepts every #471 short-name claim present in the cited evidence", () => {
    const supported = h471Intents.filter((intent) => intent.intent === "supported");

    expect(supported).toHaveLength(1);
    for (const intent of supported) {
      expect(replayById(intent.executionId).status, intent.executionId).toBe("accepted");
    }
  });

  it("rejects every #471 short-name control as an unsupported claim", () => {
    const controls = h471Intents.filter((intent) => intent.intent === "control");

    expect(controls).toHaveLength(2);
    for (const control of controls) {
      const result = replayById(control.executionId);
      expect(result.status, control.executionId).toBe("rejected");
      expect(
        result.status === "rejected" ? result.diagnostics.map((diagnostic) => diagnostic.code) : [],
        control.executionId,
      ).toContain("unsupported_claim");
    }
  });

  it("classifies every #480 opening-verb case exactly once as supported or control", () => {
    const h480Ids = captures
      .map((capture) => capture.validationInputs.executionId)
      .filter((executionId) => executionId.startsWith("sanitized-h480-"));

    expect(h480Intents.map((intent) => intent.executionId)).toEqual(h480Ids);
    for (const intent of h480Intents) {
      expect(intent.executionId.endsWith("-control"), intent.executionId).toBe(
        intent.intent === "control",
      );
    }
  });

  it("accepts every #480 opening verb before a name the cited evidence supports", () => {
    const supported = h480Intents.filter((intent) => intent.intent === "supported");

    expect(supported).toHaveLength(2);
    for (const intent of supported) {
      expect(replayById(intent.executionId).status, intent.executionId).toBe("accepted");
    }
  });

  it("rejects every #480 absent-name, title, and employer control as a factual violation", () => {
    const controls = h480Intents.filter((intent) => intent.intent === "control");

    expect(controls).toHaveLength(4);
    for (const control of controls) {
      const result = replayById(control.executionId);
      expect(result.status, control.executionId).toBe("rejected");
      expect(
        result.status === "rejected" ? result.diagnostics.map((diagnostic) => diagnostic.code) : [],
        control.executionId,
      ).toContain("factual_invariant_violation");
    }
  });

  it("classifies every #481 structured-field case exactly once as supported or control", () => {
    const h481Ids = captures
      .map((capture) => capture.validationInputs.executionId)
      .filter((executionId) => executionId.startsWith("sanitized-h481-"));

    expect(h481Intents.map((intent) => intent.executionId)).toEqual(h481Ids);
    for (const intent of h481Intents) {
      expect(intent.executionId.endsWith("-control"), intent.executionId).toBe(
        intent.intent === "control",
      );
    }
  });

  it("accepts every #481 heading, contact line, labelled list, and reformatted range found in evidence", () => {
    const supported = h481Intents.filter((intent) => intent.intent === "supported");

    expect(supported).toHaveLength(4);
    for (const intent of supported) {
      expect(replayById(intent.executionId).status, intent.executionId).toBe("accepted");
    }
  });

  it("rejects every #481 absent, changed, split-number, or split-range field as uncovered text", () => {
    const controls = h481Intents.filter((intent) => intent.intent === "control");

    expect(controls).toHaveLength(6);
    for (const control of controls) {
      const result = replayById(control.executionId);
      expect(result.status, control.executionId).toBe("rejected");
      expect(
        result.status === "rejected" ? result.diagnostics.map((diagnostic) => diagnostic.code) : [],
        control.executionId,
      ).toContain("substantive_text_uncovered");
    }
  });

  it("contains only invented local fixture identities", () => {
    expect(fixtureText).not.toContain("anthropic");
    expect(fixtureText).not.toContain("openai");
    expect(fixtureText).not.toContain("/private/");
    expect(fixtureText).not.toContain("@draft-loop");
    expect(expectationText).not.toContain("fixture://");
    expect(intentText).not.toContain("fixture://");
    expect(h466IntentText).not.toContain("fixture://");
    expect(h469IntentText).not.toContain("fixture://");
    expect(h470IntentText).not.toContain("fixture://");
    expect(h471IntentText).not.toContain("fixture://");
    expect(h480IntentText).not.toContain("fixture://");
    expect(h481IntentText).not.toContain("fixture://");
  });
});
