import type { SourceSensitivityRule } from "@draft-loop/domain/source-sensitivity";
import { describe, expect, it } from "vitest";

import {
  canonicalProfileExcludedSensitivityTiers,
  createCanonicalProfileQuoteLocator,
  filterSourceTextForCanonicalProfile,
} from "./canonical-profile-sensitivity-filter.js";

const rules: readonly SourceSensitivityRule[] = [
  { id: "r-never", tier: "never-share", match: { kind: "heading-contains", text: "compensation" } },
  { id: "r-sensitive", tier: "sensitive", match: { kind: "heading-contains", text: "contact" } },
];

const markdown = [
  "# Profile",
  "Allowed opening.",
  "",
  "## Compensation",
  "Synthetic never-share line.",
  "",
  "## Skills",
  "Allowed skills line.",
  "",
  "## Contact",
  "Synthetic sensitive line.",
  "",
].join("\n");

describe("canonical profile sensitivity filter", () => {
  it("excludes never-share and sensitive tiers by default", () => {
    expect([...canonicalProfileExcludedSensitivityTiers].sort()).toEqual([
      "never-share",
      "sensitive",
    ]);
  });

  it("removes excluded sections, joins kept runs with a blank line, and records original ranges", () => {
    const result = filterSourceTextForCanonicalProfile(markdown, "text/markdown", rules);
    expect(result.status).toBe("filtered");
    if (result.status !== "filtered") return;
    expect(result.text).not.toContain("never-share");
    expect(result.text).not.toContain("sensitive line");
    expect(result.text).not.toContain("Compensation");
    expect(result.text).toContain("Allowed opening.");
    expect(result.text).toContain("Allowed skills line.");
    expect(result.text).toBe(
      `${markdown.slice(0, markdown.indexOf("## Compensation"))}\n\n${markdown.slice(
        markdown.indexOf("## Skills"),
        markdown.indexOf("## Contact"),
      )}`,
    );
    expect(result.guard.originalText).toBe(markdown);
    expect(
      result.guard.excludedRanges.map((range) => markdown.slice(range.start, range.end)),
    ).toEqual([
      "## Compensation\nSynthetic never-share line.\n\n",
      "## Contact\nSynthetic sensitive line.\n",
    ]);
  });

  it("does not insert a join between kept sections that were adjacent", () => {
    const text = "# A\none\n\n## B\ntwo\n\n# Compensation\nsecret\n";
    const result = filterSourceTextForCanonicalProfile(text, "text/markdown", rules);
    expect(result).toMatchObject({ status: "filtered", text: "# A\none\n\n## B\ntwo\n\n" });
  });

  it("leaves a source unchanged without rules, without a match, or when it is not Markdown", () => {
    expect(filterSourceTextForCanonicalProfile(markdown, "text/markdown", undefined)).toEqual({
      status: "unchanged",
    });
    expect(filterSourceTextForCanonicalProfile(markdown, "text/markdown", [])).toEqual({
      status: "unchanged",
    });
    expect(
      filterSourceTextForCanonicalProfile("# Skills\nAllowed.\n", "text/markdown", rules),
    ).toEqual({ status: "unchanged" });
    expect(filterSourceTextForCanonicalProfile(markdown, "text/plain", rules)).toEqual({
      status: "unchanged",
    });
  });

  it("reports a source whose every section is excluded", () => {
    expect(
      filterSourceTextForCanonicalProfile(
        "# Compensation\nSynthetic never-share line.\n",
        "text/markdown",
        rules,
      ),
    ).toEqual({ status: "fully-excluded" });
    expect(
      filterSourceTextForCanonicalProfile("\n\n# Contact\nSynthetic.\n", "text/markdown", rules),
    ).toEqual({ status: "fully-excluded" });
  });

  it("lets a caller allow sensitive sections while still excluding never-share", () => {
    const result = filterSourceTextForCanonicalProfile(
      markdown,
      "text/markdown",
      rules,
      new Set(["never-share"]),
    );
    expect(result.status).toBe("filtered");
    if (result.status !== "filtered") return;
    expect(result.text).toContain("Synthetic sensitive line.");
    expect(result.text).not.toContain("never-share");
  });

  describe("quote locator", () => {
    const filtered = filterSourceTextForCanonicalProfile(markdown, "text/markdown", rules);
    if (filtered.status !== "filtered") throw new Error("expected a filtered source");
    const locate = createCanonicalProfileQuoteLocator(filtered.guard);

    it("accepts a quote inside allowed text, ignoring case and whitespace", () => {
      expect(locate("Allowed opening.")).toBe(true);
      expect(locate("allowed   SKILLS\nline.")).toBe(true);
    });

    it("rejects a quote that exists only in excluded text", () => {
      expect(locate("Synthetic never-share line.")).toBe(false);
      expect(locate("Synthetic sensitive line.")).toBe(false);
    });

    it("rejects a quote that spans the removed section", () => {
      expect(locate("Allowed opening. ## Skills")).toBe(false);
    });

    it("accepts a quote when any occurrence is outside the excluded ranges", () => {
      const text = "# Compensation\nShared phrase here.\n\n# Skills\nShared phrase here.\n";
      const result = filterSourceTextForCanonicalProfile(text, "text/markdown", rules);
      if (result.status !== "filtered") throw new Error("expected a filtered source");
      expect(createCanonicalProfileQuoteLocator(result.guard)("Shared phrase here.")).toBe(true);
      const onlyExcluded = filterSourceTextForCanonicalProfile(
        "# Skills\nOther.\n\n# Compensation\nShared phrase here.\n",
        "text/markdown",
        rules,
      );
      if (onlyExcluded.status !== "filtered") throw new Error("expected a filtered source");
      expect(createCanonicalProfileQuoteLocator(onlyExcluded.guard)("Shared phrase here.")).toBe(
        false,
      );
    });

    it("rejects an empty quote", () => {
      expect(locate("   ")).toBe(false);
    });

    it("matches compatibility and combining-mark text the way grounding does", () => {
      const text = "# Skills\nCafé ＡPI work today.\n\n# Compensation\nsecret\n";
      const result = filterSourceTextForCanonicalProfile(text, "text/markdown", rules);
      if (result.status !== "filtered") throw new Error("expected a filtered source");
      const accented = createCanonicalProfileQuoteLocator(result.guard);
      expect(accented("Café API work today.")).toBe(true);
    });
  });
});
