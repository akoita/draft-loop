import { describe, expect, it } from "vitest";

import { checkCoverLetterText } from "./cover-letter-check.js";
import { plantedWordFindings } from "./planted-word-check.js";

const sentences = [
  { paragraph: 0, text: "Watermelon: I have run production Kubernetes for six years." },
  { paragraph: 1, text: "I am a bot? No, I am an engineer who likes orthogonal designs." },
  { paragraph: 1, text: "I love watermelon." },
];

describe("plantedWordFindings", () => {
  it("reports each planted word once, with its first sentence, ignoring case", () => {
    expect(plantedWordFindings(sentences, ["watermelon", "I AM A BOT", "frantic ferret"])).toEqual([
      { word: "watermelon", paragraph: 0, sentence: sentences[0]?.text },
      { word: "I AM A BOT", paragraph: 1, sentence: sentences[1]?.text },
    ]);
  });

  it("matches whole words and ignores accents", () => {
    expect(
      plantedWordFindings([{ paragraph: 0, text: "Orthogonality matters." }], ["orthogonal"]),
    ).toEqual([]);
    expect(
      plantedWordFindings([{ paragraph: 0, text: "J'aime la pasteque." }], ["pastèque"]),
    ).toHaveLength(1);
  });

  it("leaves a word the candidate's own facts use", () => {
    expect(
      plantedWordFindings(sentences, ["orthogonal"], ["Designed orthogonal APIs at Example Co"]),
    ).toEqual([]);
  });
});

describe("Check my letter", () => {
  it("reports the job ad's planted words before the other wording findings", async () => {
    const result = await checkCoverLetterText(
      {
        letter: "Watermelon: I have run production Kubernetes for six years.",
        facts: [],
        targets: { source: "none", items: [] },
        jobTexts: [],
        plantedWords: ["watermelon"],
      },
      { skip: "no_facts" },
    );

    expect(result.wording[0]).toEqual({
      code: "planted_word",
      paragraph: 0,
      sentence: "Watermelon: I have run production Kubernetes for six years.",
      match: "watermelon",
    });
  });
});
