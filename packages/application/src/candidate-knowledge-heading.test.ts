import { describe, expect, it } from "vitest";
import {
  isLeadingMarkdownHeadingOnly,
  parseLeadingMarkdownHeading,
} from "./candidate-knowledge-heading.js";

describe("candidate knowledge leading headings", () => {
  it("parses a plain heading and one optional evidence-id preamble", () => {
    expect(parseLeadingMarkdownHeading("## Training")).toEqual({
      line: "## Training",
      level: 2,
      lineIndex: 0,
    });
    expect(parseLeadingMarkdownHeading("<!-- evidence-id: a-training -->\n## Training")).toEqual({
      line: "## Training",
      level: 2,
      lineIndex: 1,
    });
    expect(parseLeadingMarkdownHeading("preceding text\n## Training")).toBeUndefined();
  });

  it("distinguishes heading-only chunks from chunks with body content", () => {
    expect(isLeadingMarkdownHeadingOnly("## Training\n\n")).toBe(true);
    expect(isLeadingMarkdownHeadingOnly("<!-- evidence-id: a-training -->\n## Training")).toBe(
      true,
    );
    expect(
      isLeadingMarkdownHeadingOnly(
        "<!-- evidence-id: a-training -->\n## Training\nCloud operations workshop.",
      ),
    ).toBe(false);
  });
});
