import { describe, expect, it } from "vitest";
import {
  classifySourceSections,
  defaultSourceSensitivityRuleSuggestions,
  normalizeHeadingText,
  partitionMarkdownSections,
  type SourceSensitivityRule,
} from "./source-sensitivity.js";

const sample = [
  "Intro line before any heading.",
  "# Projects",
  "General notes.",
  "## Alpha Service",
  "Built a fictional thing.",
  "## Compensation Notes",
  "Target figure goes here.",
  "### Details",
  "More detail.",
  "# Contact",
  "Fictional address.",
  "",
].join("\n");

function contains(id: string, tier: SourceSensitivityRule["tier"], text: string) {
  return { id, tier, match: { kind: "heading-contains", text } } as const;
}

function tiersByPath(text: string, rules: readonly SourceSensitivityRule[]) {
  return Object.fromEntries(
    classifySourceSections(text, rules).map((s) => [s.headingPath.join(" > "), s.tier]),
  );
}

describe("partitionMarkdownSections", () => {
  it("returns no sections for empty text", () => {
    expect(partitionMarkdownSections("")).toEqual([]);
    expect(classifySourceSections("", [contains("a", "sensitive", "x")])).toEqual([]);
  });

  it("builds nested heading paths and levels", () => {
    const sections = partitionMarkdownSections(sample);
    expect(sections.map((s) => [s.level, s.headingPath.join(" > ")])).toEqual([
      [0, ""],
      [1, "Projects"],
      [2, "Projects > Alpha Service"],
      [2, "Projects > Compensation Notes"],
      [3, "Projects > Compensation Notes > Details"],
      [1, "Contact"],
    ]);
  });

  it("covers the whole text with contiguous sections", () => {
    const sections = partitionMarkdownSections(sample);
    expect(sections[0]?.start).toBe(0);
    expect(sections.at(-1)?.end).toBe(sample.length);
    for (let i = 1; i < sections.length; i++) {
      expect(sections[i]?.start).toBe(sections[i - 1]?.end);
    }
    const second = sections[1];
    expect(sample.slice(second?.start, second?.end).startsWith("# Projects")).toBe(true);
  });

  it("treats text before the first heading as the root section", () => {
    const [root] = partitionMarkdownSections(sample);
    expect(root).toMatchObject({ headingPath: [], level: 0, start: 0 });
    expect(sample.slice(root?.start, root?.end)).toBe("Intro line before any heading.\n");
  });

  it("has no root section when the text starts with a heading", () => {
    const sections = partitionMarkdownSections("# Only\nbody");
    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({ level: 1, start: 0, end: 11 });
  });

  it("returns a single root section when there are no headings", () => {
    expect(partitionMarkdownSections("just text")).toEqual([
      { headingPath: [], level: 0, start: 0, end: 9 },
    ]);
  });

  it("ignores # lines inside fenced code blocks", () => {
    const text = [
      "# Real",
      "```sh",
      "# Compensation",
      "```",
      "~~~",
      "## Private",
      "~~~",
      "## After",
    ].join("\n");
    expect(partitionMarkdownSections(text).map((s) => s.headingPath.join(" > "))).toEqual([
      "Real",
      "Real > After",
    ]);
  });

  it("requires a space after the hashes and at most three leading spaces", () => {
    const text = "#nospace\n    # indented code\n   ## Ok\n####### seven\n#\n";
    expect(partitionMarkdownSections(text).map((s) => [s.level, s.headingPath.join(">")])).toEqual([
      [0, ""],
      [2, "Ok"],
      [1, ""],
    ]);
  });

  it("removes trailing # characters and surrounding whitespace", () => {
    const sections = partitionMarkdownSections("##  Title ##  \n### C# notes\n");
    expect(sections.map((s) => s.headingPath.at(-1))).toEqual(["Title", "C# notes"]);
  });

  it("does not recognise setext headings", () => {
    const sections = partitionMarkdownSections("Title\n=====\nbody\n\nOther\n-----\n");
    expect(sections).toHaveLength(1);
    expect(sections[0]?.level).toBe(0);
  });

  it("handles CRLF line endings", () => {
    const sections = partitionMarkdownSections("# A\r\nbody\r\n## B\r\n");
    expect(sections.map((s) => s.headingPath.join(">"))).toEqual(["A", "A>B"]);
  });
});

describe("normalizeHeadingText", () => {
  it("lowercases, strips accents and emphasis, and collapses whitespace", () => {
    expect(normalizeHeadingText("  **Rémunération**   `Café`_x_ ")).toBe("remuneration cafex");
  });
});

describe("classifySourceSections", () => {
  it("defaults to normal when no rule matches", () => {
    const sections = classifySourceSections(sample, []);
    expect(sections.every((s) => s.tier === "normal" && s.matchedRuleIds.length === 0)).toBe(true);
  });

  it("inherits the tier from ancestor headings", () => {
    const tiers = tiersByPath(sample, [contains("comp", "never-share", "compensation")]);
    expect(tiers).toMatchObject({
      Projects: "normal",
      "Projects > Alpha Service": "normal",
      "Projects > Compensation Notes": "never-share",
      "Projects > Compensation Notes > Details": "never-share",
      Contact: "normal",
    });
  });

  it("lets the strictest tier win regardless of rule order", () => {
    const rules = [
      contains("a", "never-share", "compensation"),
      contains("b", "sensitive", "notes"),
      contains("c", "sensitive", "details"),
    ];
    const sections = classifySourceSections(sample, rules);
    const details = sections.find((s) => s.headingPath.at(-1) === "Details");
    expect(details?.tier).toBe("never-share");
    expect(details?.matchedRuleIds).toEqual(["a", "b", "c"]);
    const reversed = classifySourceSections(sample, [...rules].reverse());
    expect(reversed.find((s) => s.headingPath.at(-1) === "Details")?.tier).toBe("never-share");
  });

  it("matches heading-path rules on the exact path and its subtree only", () => {
    const rule: SourceSensitivityRule = {
      id: "p",
      tier: "sensitive",
      match: { kind: "heading-path", path: ["projects", "COMPENSATION notes"] },
    };
    expect(tiersByPath(sample, [rule])).toMatchObject({
      Projects: "normal",
      "Projects > Alpha Service": "normal",
      "Projects > Compensation Notes": "sensitive",
      "Projects > Compensation Notes > Details": "sensitive",
      Contact: "normal",
    });
    const wrongParent: SourceSensitivityRule = {
      id: "q",
      tier: "sensitive",
      match: { kind: "heading-path", path: ["Compensation Notes"] },
    };
    expect(classifySourceSections(sample, [wrongParent]).every((s) => s.tier === "normal")).toBe(
      true,
    );
  });

  it("matches case- and accent-insensitively", () => {
    const text = "# Rémunération Prévue\nfictional\n## ÉTÉ\nx\n";
    const tiers = tiersByPath(text, [
      contains("r", "never-share", "REMUNERATION"),
      {
        id: "p",
        tier: "sensitive",
        match: { kind: "heading-path", path: ["rémunération prévue", "ete"] },
      },
    ]);
    expect(tiers).toEqual({
      "Rémunération Prévue": "never-share",
      "Rémunération Prévue > ÉTÉ": "never-share",
    });
  });
});

describe("defaultSourceSensitivityRuleSuggestions", () => {
  it("has unique stable ids, frozen entries, and expected tiers", () => {
    const ids = defaultSourceSensitivityRuleSuggestions.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(Object.isFrozen(defaultSourceSensitivityRuleSuggestions)).toBe(true);
    expect(Object.isFrozen(defaultSourceSensitivityRuleSuggestions[0])).toBe(true);
    const tierOf = (id: string) =>
      defaultSourceSensitivityRuleSuggestions.find((r) => r.id === id)?.tier;
    expect(tierOf("suggest-salary")).toBe("never-share");
    expect(tierOf("suggest-contact")).toBe("sensitive");
  });

  it("classifies a synthetic source through the suggestions", () => {
    const tiers = tiersByPath(sample, defaultSourceSensitivityRuleSuggestions);
    expect(tiers).toMatchObject({
      "Projects > Compensation Notes": "never-share",
      Contact: "sensitive",
      "Projects > Alpha Service": "normal",
    });
  });
});
