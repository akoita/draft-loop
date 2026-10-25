import { describe, expect, it } from "vitest";

import { readableFindingMessage } from "./finding-message.js";

/** Fictional ids and text, shaped as the critic quotes them. */
const requirements = new Map([
  ["extraction-requirement-5d47a1", "Design reliable asynchronous event processing."],
]);
const claims = new Map([
  ["claim-9277b3-0-1-2", "Owned a parcel-event ingestion feature with retries and replay."],
]);

describe("readable finding messages", () => {
  it("names requirements and claims by their text", () => {
    expect(
      readableFindingMessage(
        "Lead with requirement 'extraction-requirement-5d47a1' using claim-9277b3-0-1-2.",
        { requirements, claims },
      ),
    ).toBe(
      "Lead with requirement “Design reliable asynchronous event processing.” using “Owned a parcel-event ingestion feature with retries and replay.”.",
    );
  });

  it("replaces evidence ids, which have no label, with plain words", () => {
    expect(
      readableFindingMessage(
        "Claim claim-9277b3-0-1-2; evidence-reference-5 does not show it. Supported by retrievedEvidence 63b41e9f0a2c7d8e.",
        { claims },
      ),
    ).toBe(
      "Claim “Owned a parcel-event ingestion feature with retries and replay.”; its cited evidence does not show it. Supported by the cited evidence.",
    );
    expect(readableFindingMessage("See chunk 63b41e9f0a2c7d8e4b5a6c7d8e9f0a1b.")).toBe(
      "See chunk the cited evidence.",
    );
  });

  it("names ids it has no label for generically, and keeps a long label short", () => {
    const long = new Map([["claim-long", "word ".repeat(40)]]);
    expect(
      readableFindingMessage("Claim claim-old-1 and requirement-xyz overlap claim-long.", {
        claims: long,
      }),
    ).toMatch(/^Claim a claim and a job requirement overlap “(word ){15}.*…”\.$/u);
  });

  it("leaves a message without ids as it is", () => {
    expect(readableFindingMessage("Two bullets repeat the same fact.")).toBe(
      "Two bullets repeat the same fact.",
    );
  });
});
