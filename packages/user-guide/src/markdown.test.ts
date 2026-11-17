import { describe, expect, it } from "vitest";

import { helpGuide, helpGuideLanguages } from "./guide.js";
import { guideMarkdown } from "./markdown.js";

describe("the user guide as Markdown (#2881)", () => {
  it("puts the title, the intro and every section heading in reading order", () => {
    const guide = helpGuide("en");
    const text = guideMarkdown(guide, "DraftLoop user guide");

    expect(text.startsWith("# DraftLoop user guide\n\n")).toBe(true);
    const positions = guide.sections.map((section) => text.indexOf(`## ${section.title}`));
    expect(positions.every((position) => position > 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("chooses French for fr and its regional tags, English otherwise", () => {
    expect(helpGuideLanguages).toEqual(["en", "fr"]);
    expect(helpGuide("fr-CA")).toBe(helpGuide("fr"));
    expect(helpGuide("de")).toBe(helpGuide("en"));
  });
});
