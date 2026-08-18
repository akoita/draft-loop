import { describe, expect, it } from "vitest";

import { type DiffOp, type DiffOpKind, diffWords, MAX_DIFF_TOKENS } from "./diff.js";

function textOf(ops: readonly DiffOp[], kinds: readonly DiffOpKind[]): string {
  return ops
    .filter((op) => kinds.includes(op.kind))
    .map((op) => op.text)
    .join("");
}

function kindsOf(ops: readonly DiffOp[]): readonly DiffOpKind[] {
  return ops.map((op) => op.kind);
}

const cvSentencePairs: readonly (readonly [string, string])[] = [
  [
    "TypeScript engineer with systems experience.",
    "TypeScript systems engineer focused on reliable local-first products.",
  ],
  ["Led a 40% improvement in deployment speed.", "Led a 25% improvement in deployment speed."],
  [
    "Built an evidence pipeline for candidate documents.",
    "Built and maintained an evidence pipeline for candidate documents and job descriptions.",
  ],
  [
    "Mentored three engineers, ran design reviews, and owned the release process.",
    "Mentored three engineers and owned the release process.",
  ],
  ["  Summary of prior work  ", "  Summary of prior impact  "],
  ["Shipped features, tests, and docs.", "Shipped features and docs."],
  ["Delivered\ntwo\nreleases per quarter.", "Delivered\nthree\nreleases per quarter."],
  ["Remote-first collaboration across four time zones.", "Wrote the incident response runbook."],
];

describe("diffWords", () => {
  it("returns a single equal op for identical inputs", () => {
    expect(diffWords("Led the platform migration.", "Led the platform migration.")).toEqual([
      { kind: "equal", text: "Led the platform migration." },
    ]);
  });

  it("returns no ops when both inputs are empty", () => {
    expect(diffWords("", "")).toEqual([]);
  });

  it("returns a single insert when the previous draft is empty", () => {
    expect(diffWords("", "Owned the release process.")).toEqual([
      { kind: "insert", text: "Owned the release process." },
    ]);
  });

  it("returns a single delete when the next draft is empty", () => {
    expect(diffWords("Owned the release process.", "")).toEqual([
      { kind: "delete", text: "Owned the release process." },
    ]);
  });

  it("reports an inserted word without disturbing the surrounding text", () => {
    expect(diffWords("Led deployment improvements.", "Led major deployment improvements.")).toEqual(
      [
        { kind: "equal", text: "Led " },
        { kind: "insert", text: "major " },
        { kind: "equal", text: "deployment improvements." },
      ],
    );
  });

  it("reports a deleted word without disturbing the surrounding text", () => {
    expect(diffWords("Led major deployment improvements.", "Led deployment improvements.")).toEqual(
      [
        { kind: "equal", text: "Led " },
        { kind: "delete", text: "major " },
        { kind: "equal", text: "deployment improvements." },
      ],
    );
  });

  it("reports a mid-sentence replacement as a delete followed by an insert", () => {
    expect(
      diffWords("Improved deployment speed by 40%.", "Improved deployment speed by 25%."),
    ).toEqual([
      { kind: "equal", text: "Improved deployment speed by " },
      { kind: "delete", text: "40%." },
      { kind: "insert", text: "25%." },
    ]);
  });

  it("preserves leading and trailing whitespace exactly", () => {
    const ops = diffWords("\t  Summary of work \n", "\t  Summary of impact \n");
    expect(textOf(ops, ["equal", "delete"])).toBe("\t  Summary of work \n");
    expect(textOf(ops, ["equal", "insert"])).toBe("\t  Summary of impact \n");
    expect(ops[0]).toEqual({ kind: "equal", text: "\t  Summary of " });
    expect(ops[ops.length - 1]).toEqual({ kind: "equal", text: " \n" });
  });

  it("treats punctuation as part of the word it is attached to", () => {
    const ops = diffWords("Shipped features, tests, and docs.", "Shipped features and docs.");
    expect(ops).toEqual([
      { kind: "equal", text: "Shipped " },
      { kind: "delete", text: "features, tests," },
      { kind: "insert", text: "features" },
      { kind: "equal", text: " and docs." },
    ]);
  });

  it("keeps a word untouched when only its trailing punctuation changes elsewhere", () => {
    const ops = diffWords(
      "Owned release, deploy, and oncall.",
      "Owned release, deploy and oncall.",
    );
    expect(textOf(ops, ["equal", "delete"])).toBe("Owned release, deploy, and oncall.");
    expect(textOf(ops, ["equal", "insert"])).toBe("Owned release, deploy and oncall.");
    expect(kindsOf(ops)).toContain("delete");
    expect(kindsOf(ops)).toContain("insert");
  });

  it("reassembles both sides losslessly for realistic CV sentence pairs", () => {
    for (const [previous, next] of cvSentencePairs) {
      const ops = diffWords(previous, next);
      expect(textOf(ops, ["equal", "delete"])).toBe(previous);
      expect(textOf(ops, ["equal", "insert"])).toBe(next);
    }
  });

  it("never emits two adjacent ops of the same kind", () => {
    const pairs: readonly (readonly [string, string])[] = [
      ...cvSentencePairs,
      ...cvSentencePairs.map(([previous, next]) => [next, previous] as const),
      ["", "Owned the release process."],
      ["Owned the release process.", ""],
      ["a b c d e", "e d c b a"],
    ];
    for (const [previous, next] of pairs) {
      const kinds = kindsOf(diffWords(previous, next));
      for (let index = 1; index < kinds.length; index += 1) {
        expect(kinds[index]).not.toBe(kinds[index - 1]);
      }
    }
  });

  it("still aligns word by word just below the token threshold", () => {
    const words = Array.from({ length: 700 }, (_, index) => `word${index}`);
    const previous = words.join(" ");
    const next = [...words.slice(0, 350), "inserted", ...words.slice(350)].join(" ");
    const ops = diffWords(previous, next);
    expect(ops.length).toBeGreaterThan(2);
    expect(textOf(ops, ["equal", "delete"])).toBe(previous);
    expect(textOf(ops, ["equal", "insert"])).toBe(next);
  });

  it("falls back to a whole-text replacement above the token threshold", () => {
    const words = Array.from({ length: MAX_DIFF_TOKENS }, (_, index) => `word${index}`);
    const previous = words.join(" ");
    const next = `${previous} appended`;
    const ops = diffWords(previous, next);
    expect(ops).toEqual([
      { kind: "delete", text: previous },
      { kind: "insert", text: next },
    ]);
    expect(textOf(ops, ["equal", "delete"])).toBe(previous);
    expect(textOf(ops, ["equal", "insert"])).toBe(next);
  });
});
