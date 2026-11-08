import { describe, expect, it } from "vitest";

import { writingTells } from "./writing-tells.js";

// Invented letters.
const plain = Array.from(
  { length: 4 },
  (_, index) =>
    `Paragraph ${["one", "two", "three", "four"][index]} says what I did at the ledger team. ${"I fixed the nightly report so it ran before nine. ".repeat(6)}`,
);

describe("writingTells", () => {
  it("passes a plain letter of the brief's length", () => {
    expect(writingTells(plain)).toEqual([]);
  });

  it("flags stock phrases as whole words only, in English and French", () => {
    const tells = writingTells([
      "I am writing to express my interest. I am passionate about data.",
      "We leveraged nothing. Je suis passionnée par les données.",
    ]);
    expect(tells.filter((tell) => tell.code === "stock_phrase").map((tell) => tell.match)).toEqual([
      "i am writing to express",
      "passionate about",
      "passionnée par",
    ]);
    expect(tells[0]).toMatchObject({
      paragraph: 0,
      sentence: "I am writing to express my interest.",
    });
  });

  it("flags dashes only when the letter leans on them", () => {
    expect(writingTells(["One dash — fine here."]).map((tell) => tell.code)).toEqual([
      "word_count",
    ]);
    const heavy = writingTells(["Data — fast. Reports — late.", "Then — fixed."]);
    expect(heavy.filter((tell) => tell.code === "heavy_dashes")).toHaveLength(3);
  });

  it("flags lists of three and paragraphs that open alike", () => {
    const tells = writingTells([
      "I am fast, reliable and calm.",
      "I am also careful.",
      "Mon travail est rapide, fiable et simple.",
    ]);
    expect(tells.map((tell) => tell.code)).toEqual([
      "list_of_three",
      "list_of_three",
      "mirrored_openings",
      "word_count",
    ]);
    expect(tells[2]).toMatchObject({ paragraph: 1, match: "i am" });
    expect(tells[3]).toEqual({ code: "word_count", match: "17" });
  });

  it("flags sentences that only recite a skill (#2583)", () => {
    const tells = writingTells([
      "The OpenAI API is one of my skills. SSRF protection and LLM security are skills I bring.",
    ]).filter((tell) => tell.code === "stock_phrase");
    expect(tells.map((tell) => tell.match)).toEqual(["is one of my skills", "skills i bring"]);
  });
});
