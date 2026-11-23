import { describe, expect, it } from "vitest";

import { fixtureKit } from "./cover-letter-kit-fixture.test-support.js";
import {
  kitCitedTexts,
  kitRequirementNumbers,
  letterChanged,
  letterParagraphs,
  letterText,
  letterWordCount,
  ownLetterProblem,
} from "./cover-letter-kit-model.js";

describe("the person's letter", () => {
  it("splits into paragraphs at blank lines and joins back", () => {
    const text = "  Dear team,\n\nFirst line\nsame paragraph.\n \n\n\nLast one.  ";
    expect(letterParagraphs(text)).toEqual([
      "Dear team,",
      "First line\nsame paragraph.",
      "Last one.",
    ]);
    expect(letterText(["One.", "Two."])).toBe("One.\n\nTwo.");
    expect(letterWordCount(" one two\nthree ")).toBe(3);
  });

  it("tells a change from the saved letter, ignoring spacing around paragraphs", () => {
    expect(letterChanged("One.\n\n Two. ", ["One.", "Two."])).toBe(false);
    expect(letterChanged("One.", ["One.", "Two."])).toBe(true);
    expect(letterChanged("One.", undefined)).toBe(true);
    expect(letterChanged("  ", undefined)).toBe(false);
  });

  it("refuses an empty letter, too many paragraphs or a paragraph too long", () => {
    expect(ownLetterProblem(" \n\n ")).toBe("Write your letter first.");
    expect(ownLetterProblem(Array.from({ length: 11 }, () => "P.").join("\n\n"))).toContain(
      "at most 10 paragraphs",
    );
    expect(ownLetterProblem("x".repeat(4_001))).toContain("at most 4000 characters");
    expect(ownLetterProblem("A fine letter.")).toBeUndefined();
  });
});

describe("the kit's citations", () => {
  it("names what a note uses and the requirements a paragraph answers", () => {
    expect(kitCitedTexts(fixtureKit, { factIds: ["f2"], findingIds: ["e1", "missing"] })).toEqual([
      "Led three analysts on the pricing review",
      "Opened an office in a fictional city",
    ]);
    expect(kitRequirementNumbers(fixtureKit, ["r2", "unknown", "r1"])).toEqual([2, 1]);
  });
});
