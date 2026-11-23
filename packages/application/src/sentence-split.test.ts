import { describe, expect, it } from "vitest";

import { sentencesOf } from "./sentence-split.js";

describe("sentencesOf", () => {
  it("splits on end marks followed by a new sentence", () => {
    expect(sentencesOf("You led a team. Did it ship? Yes! “Fine.” Then…  Next")).toEqual([
      "You led a team.",
      "Did it ship?",
      "Yes!",
      "“Fine.”",
      "Then…",
      "Next",
    ]);
  });

  it("keeps dotted words, versions and abbreviations whole (#2804)", () => {
    expect(
      sentencesOf(
        "You ran Node.js on AWS for 2.5 years. Name a tool, e.g. Kafka, i.e. a queue. It beat Go vs. Rust in the U.S. market. Stop there.",
      ),
    ).toEqual([
      "You ran Node.js on AWS for 2.5 years.",
      "Name a tool, e.g. Kafka, i.e. a queue.",
      "It beat Go vs. Rust in the U.S. market.",
      "Stop there.",
    ]);
  });

  it("does not end a sentence before a lowercase word", () => {
    expect(sentencesOf("Built with TypeScript or Node. js on AWS.")).toEqual([
      "Built with TypeScript or Node. js on AWS.",
    ]);
  });

  it("returns nothing for blank text", () => {
    expect(sentencesOf("  \n ")).toEqual([]);
  });
  it("splits long runs of end marks in linear time", () => {
    const text = `${"!".repeat(100_000)}x ${" ".repeat(100_000)}`;
    const started = performance.now();
    sentencesOf(text);
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});
