import { describe, expect, it } from "vitest";

import { findRepeatedPhrase } from "./repeated-phrase.js";

describe("findRepeatedPhrase", () => {
  it("finds a tail stitched in twice", () => {
    const text =
      "Took back ownership of the deployment environment for the blockchain stack, the API and the Keycloak infrastructure; the API and the Keycloak infrastructure.";
    const repeated = findRepeatedPhrase(text);
    expect(repeated?.phrase).toBe("the API and the Keycloak infrastructure");
    expect(text.slice(repeated?.start, repeated?.end)).toBe(repeated?.phrase);
    expect(repeated?.end).toBe(text.length - 1);
  });

  it("ignores case and the punctuation between the copies", () => {
    expect(
      findRepeatedPhrase(
        "Worked with business, operations and infrastructure teams; business; operations and infrastructure teams.",
      )?.phrase,
    ).toBe("business; operations and infrastructure teams");
  });

  it("ignores short echoes and repeats that are not back to back", () => {
    expect(findRepeatedPhrase("Very very fast releases.")).toBeUndefined();
    expect(
      findRepeatedPhrase("Owned the release process and later owned the release process."),
    ).toBeUndefined();
    expect(
      findRepeatedPhrase("Built Python services for Ethereum event ingestion."),
    ).toBeUndefined();
    expect(findRepeatedPhrase("")).toBeUndefined();
  });
});
