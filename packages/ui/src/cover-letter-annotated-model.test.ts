import { describe, expect, it } from "vitest";

import type { AnnotatedDraftParagraphView } from "./cover-letter-annotated-contract.js";
import {
  annotatedParagraphRole,
  annotatedPrompt,
  annotatedSegments,
  annotatedWhy,
  answeredRequirement,
  genericPhraseSpans,
  initialRewrites,
  ownWordsShare,
  rewriteParagraphs,
} from "./cover-letter-annotated-model.js";
import { fixtureKit } from "./cover-letter-kit-fixture.test-support.js";

const paragraph = (
  text: string,
  factIds: readonly string[] = [],
  findingIds: readonly string[] = [],
): AnnotatedDraftParagraphView => ({
  text,
  facts: factIds.map((factId) => ({ factId, text: `Fact ${factId}` })),
  employerFacts: findingIds.map((findingId) => ({ findingId, text: `Finding ${findingId}` })),
});

describe("the annotated draft's notes", () => {
  it("gives each paragraph its role from where it sits and what it cites", () => {
    expect(annotatedParagraphRole(paragraph("Hello"), 0, 4)).toBe("opening");
    expect(annotatedParagraphRole(paragraph("Proof", ["f1"]), 1, 4)).toBe("proof");
    expect(annotatedParagraphRole(paragraph("Their office", [], ["e1"]), 2, 4)).toBe("employer");
    expect(annotatedParagraphRole(paragraph("Thanks"), 3, 4)).toBe("closing");
    // A two-paragraph letter has no closing of its own.
    expect(annotatedParagraphRole(paragraph("Proof"), 1, 2)).toBe("proof");
  });

  it("names the kit requirement a paragraph answers, by its facts or by shared words", () => {
    expect(answeredRequirement(paragraph("Anything", ["f2"]), fixtureKit)).toEqual({
      number: 2,
      text: "Leads a small analytics team",
    });
    expect(
      answeredRequirement(paragraph("I build reporting for finance teams each month."), fixtureKit),
    ).toEqual({ number: 1, text: "Builds SQL reporting for finance teams" });
    expect(answeredRequirement(paragraph("Thank you for reading."), fixtureKit)).toBeUndefined();
    expect(answeredRequirement(paragraph("Anything", ["f2"]), undefined)).toBeUndefined();
  });

  it("says why a paragraph is there and asks the person to say it their way", () => {
    expect(annotatedWhy("proof", { number: 1, text: "SQL reporting" })).toBe(
      "Answers requirement 1: SQL reporting",
    );
    expect(annotatedWhy("opening", undefined)).toContain("Opens the letter");
    expect(annotatedWhy("closing", undefined)).toContain("Closes the letter");
    for (const role of ["opening", "proof", "employer", "closing"] as const) {
      expect(annotatedPrompt(role)).not.toBe("");
    }
  });
});

describe("generic phrases", () => {
  it("finds stock phrases and empty superlatives as whole words, in reading order", () => {
    const text = "I am Passionate about data and an exceptional, results-driven analyst.";
    expect(genericPhraseSpans(text).map((span) => span.phrase)).toEqual([
      "Passionate about",
      "exceptional",
      "results-driven",
    ]);
    // Part of a longer word is not a match.
    expect(genericPhraseSpans("We leveraged it.")).toEqual([]);
    expect(genericPhraseSpans("Une solide expérience en SQL.")[0]?.phrase).toBe(
      "solide expérience",
    );
  });

  it("cuts the paragraph into plain and generic stretches that join back to the text", () => {
    const text = "My passion for SQL is a testament to my outstanding work.";
    const segments = annotatedSegments(text);
    expect(segments.map((segment) => segment.text).join("")).toBe(text);
    expect(segments.filter((segment) => segment.generic).map((segment) => segment.text)).toEqual([
      "passion for",
      "testament to",
      "outstanding",
    ]);
    expect(annotatedSegments("Plain words.")).toEqual([{ text: "Plain words.", generic: false }]);
  });
});

describe("the own-words meter", () => {
  const draft = "I cut month-end report time by 40% at Fictional Ltd, for twelve teams.";

  it("counts a word as copied only inside five words in a row the draft has", () => {
    expect(ownWordsShare("", draft)).toBeUndefined();
    expect(ownWordsShare(draft, draft)).toEqual({ words: 13, ownWords: 0, share: 0 });
    const mine = "At Fictional Ltd my reports got faster, which twelve teams noticed.";
    expect(ownWordsShare(mine, draft)).toEqual({ words: 11, ownWords: 11, share: 1 });
    // Six copied words in eight, whatever the case and punctuation.
    expect(ownWordsShare("Honestly, I CUT month-end report time by forty", draft)).toEqual({
      words: 8,
      ownWords: 2,
      share: 2 / 8,
    });
  });
});

describe("the person's column", () => {
  it("lays a saved letter into one box per drafted paragraph, extras in the last", () => {
    expect(initialRewrites(3, undefined)).toEqual(["", "", ""]);
    expect(initialRewrites(2, ["One", "Two", "Three"])).toEqual(["One", "Two\n\nThree"]);
    expect(initialRewrites(3, ["One"])).toEqual(["One", "", ""]);
  });

  it("saves the boxes' paragraphs, leaving empty boxes out", () => {
    expect(rewriteParagraphs(["  One ", "", "Two\n\nThree"])).toEqual(["One", "Two", "Three"]);
  });
});
