import { describe, expect, it } from "vitest";

import { diffWords } from "./diff.js";
import type { ReviewBlock } from "./model.js";
import { collapseFragmentedRedline, lineSimilarity, pairDraftBlocks } from "./review.js";

function block(id: string, text: string): ReviewBlock {
  return { id, type: "paragraph", text, claimIds: [] };
}

describe("pairDraftBlocks", () => {
  // A header revision that splits one contact line into one line per field, with fresh ids.
  const previousHeader = [
    block("p-name", "Jordan Example"),
    block("p-location", "Lyon, France."),
    block("p-contact", "jordan@example.test, +33 1 23 45 67 89, github.com/jexample"),
    block("p-languages", "French native speaker, English professional working proficiency"),
    block("p-work", "Entitled to work in the EU, no visa sponsorship required"),
  ];
  const currentHeader = [
    block("c-name", "Jordan Example"),
    block("c-location", "Lyon, France."),
    block("c-email", "jordan@example.test"),
    block("c-phone", "+33 1 23 45 67 89"),
    block("c-github", "github.com/jexample"),
    block("c-work", "Entitled to work in the EU, no visa sponsorship required"),
  ];

  it("pairs rewritten lines by their words, not by their position", () => {
    const pairs = pairDraftBlocks(currentHeader, previousHeader);
    const byKey = new Map(pairs.map((pair) => [pair.key, pair.previousText]));

    expect(byKey.get("c-name")).toBe("Jordan Example");
    expect(byKey.get("c-work")).toBe("Entitled to work in the EU, no visa sponsorship required");
    expect(byKey.get("c-email")).toBe(
      "jordan@example.test, +33 1 23 45 67 89, github.com/jexample",
    );
    // The phone line shares nothing with the languages line that used to sit at its position.
    expect(byKey.get("c-phone")).toBeNull();
    expect(byKey.get("c-github")).toBeNull();
  });

  it("keeps an unpaired previous line as a removal in its old place", () => {
    const keys = pairDraftBlocks(currentHeader, previousHeader).map((pair) => pair.key);
    expect(keys).toContain("removed-p-languages");
    expect(keys.indexOf("removed-p-languages")).toBeLessThan(keys.indexOf("c-work"));
  });

  it("still pairs a lightly reworded bullet that lost its id", () => {
    const pairs = pairDraftBlocks(
      [block("new", "Led the payments migration across three teams.")],
      [block("old", "Led the payments platform migration across three teams.")],
    );
    expect(pairs).toEqual([
      {
        key: "new",
        block: block("new", "Led the payments migration across three teams."),
        previousText: "Led the payments platform migration across three teams.",
        text: "Led the payments migration across three teams.",
      },
    ]);
  });

  it("prefers the identical previous line over an earlier similar one", () => {
    const pairs = pairDraftBlocks(
      [block("new", "Built the billing service in Go.")],
      [
        block("old-similar", "Built the billing service in Java."),
        block("old-same", "Built the billing service in Go."),
      ],
    );
    expect(pairs.find((pair) => pair.key === "new")?.previousText).toBe(
      "Built the billing service in Go.",
    );
  });
});

describe("lineSimilarity", () => {
  it("ignores case and surrounding punctuation", () => {
    expect(lineSimilarity("GitHub.com/jexample", "github.com/jexample,")).toBe(1);
  });

  it("does not pair lines that share too few words", () => {
    expect(lineSimilarity("+33 1 23 45 67 89", "French native speaker")).toBe(0);
    expect(lineSimilarity("Owned the release process.", "Wrote the incident runbook.")).toBe(0);
  });
});

describe("collapseFragmentedRedline", () => {
  it("sets a line that kept none of its words as one strike and one insertion", () => {
    const previous = "French native speaker, English professional working proficiency";
    const next = "+33 1 23 45 67 89";
    expect(collapseFragmentedRedline(diffWords(previous, next))).toEqual([
      { kind: "delete", text: previous },
      { kind: "insert", text: next },
    ]);
  });

  it("leaves a single clean replacement inside a kept sentence alone", () => {
    const ops = diffWords("Improved deployment speed by 40%.", "Improved deployment speed by 25%.");
    expect(collapseFragmentedRedline(ops)).toBe(ops);
  });

  it("leaves a wholly new line alone", () => {
    const ops = diffWords("", "Wrote the incident runbook.");
    expect(collapseFragmentedRedline(ops)).toBe(ops);
  });
});
