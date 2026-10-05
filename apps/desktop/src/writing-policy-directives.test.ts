import { defaultWritingPolicyContent } from "@draft-loop/application";
import { describe, expect, it } from "vitest";
import { readPolicySelectorValues, setPolicySelectorValue } from "./writing-policy-directives.js";

describe("readPolicySelectorValues", () => {
  it("reads the default policy's selectors", () => {
    expect(readPolicySelectorValues(defaultWritingPolicyContent)).toEqual({
      tone: "professional",
      verbosity: "concise",
      pageTarget: "two-page",
      spellingLocale: null,
    });
  });

  it("matches names case-insensitively, through list markers, with spaced colons", () => {
    const text = "- TONE : Warm\n* page   target: one-page\n+ Spelling Locale:en-GB\nVerbosity:\n";
    expect(readPolicySelectorValues(text)).toEqual({
      tone: "Warm",
      verbosity: null,
      pageTarget: "one-page",
      spellingLocale: "en-GB",
    });
  });

  it("uses the first of a repeated directive and ignores prose that merely mentions one", () => {
    const text = "Tone: direct\nTone: warm\nThe tone: here is prose\n";
    expect(readPolicySelectorValues(text).tone).toBe("direct");
    expect(readPolicySelectorValues("Write in a tone: warm.").tone).toBeNull();
  });

  it("reads CRLF text", () => {
    expect(readPolicySelectorValues("Tone: direct\r\nVerbosity: balanced\r\n")).toMatchObject({
      tone: "direct",
      verbosity: "balanced",
    });
  });
});

describe("setPolicySelectorValue", () => {
  it("replaces the value of an existing line and leaves everything else untouched", () => {
    const next = setPolicySelectorValue(defaultWritingPolicyContent, "tone", "warm");
    expect(next).toBe(defaultWritingPolicyContent.replace("Tone: professional", "Tone: warm"));
  });

  it("keeps the list marker, indent and the spelling of the name", () => {
    expect(setPolicySelectorValue("  - TONE:   warm\nUnknown: x\n", "tone", "direct")).toBe(
      "  - TONE:   direct\nUnknown: x\n",
    );
  });

  it("inserts a missing directive beside the other directives, in their style", () => {
    const text = "# Policy\n\n- Tone: warm\n- Verbosity: concise\n\n## Rules\n\n- No em dashes.\n";
    expect(setPolicySelectorValue(text, "pageTarget", "one-page")).toBe(
      "# Policy\n\n- Tone: warm\n- Verbosity: concise\n- Page target: one-page\n\n## Rules\n\n- No em dashes.\n",
    );
  });

  it("inserts under the opening heading when there are no directives", () => {
    expect(setPolicySelectorValue("# Mine\n\n- Be kind.\n", "tone", "warm")).toBe(
      "# Mine\n\nTone: warm\n\n- Be kind.\n",
    );
  });

  it("inserts at the top when there is no heading, and into empty text", () => {
    expect(setPolicySelectorValue("- Be kind.\n", "verbosity", "detailed")).toBe(
      "Verbosity: detailed\n\n- Be kind.\n",
    );
    expect(setPolicySelectorValue("", "spellingLocale", "en-GB")).toBe("Spelling locale: en-GB\n");
  });

  it("removes the line when set to null or blank, keeping other lines", () => {
    const text = "Tone: warm\nVerbosity: concise\n";
    expect(setPolicySelectorValue(text, "tone", null)).toBe("Verbosity: concise\n");
    expect(setPolicySelectorValue(text, "verbosity", "  ")).toBe("Tone: warm\n");
  });

  it("collapses repeated lines for the same directive into one", () => {
    expect(setPolicySelectorValue("Tone: warm\nRule\nTone: direct\n", "tone", "direct")).toBe(
      "Tone: direct\nRule\n",
    );
  });

  it("keeps a free-text value on one line", () => {
    expect(setPolicySelectorValue("Tone: warm\n", "spellingLocale", "en\nGB")).toBe(
      "Tone: warm\nSpelling locale: en GB\n",
    );
  });

  it("preserves CRLF line endings", () => {
    expect(setPolicySelectorValue("Tone: warm\r\nRule\r\n", "tone", "direct")).toBe(
      "Tone: direct\r\nRule\r\n",
    );
  });

  it("round-trips: what is set is what is read, and setting back restores the text", () => {
    const original = defaultWritingPolicyContent;
    for (const [directive, value] of [
      ["tone", "conversational"],
      ["verbosity", "detailed"],
      ["pageTarget", "one-page"],
      ["spellingLocale", "en-GB"],
    ] as const) {
      const changed = setPolicySelectorValue(original, directive, value);
      expect(readPolicySelectorValues(changed)[directive]).toBe(value);
    }
    const added = setPolicySelectorValue(original, "spellingLocale", "en-GB");
    expect(setPolicySelectorValue(added, "spellingLocale", null)).toBe(original);
    const toned = setPolicySelectorValue(original, "tone", "warm");
    expect(setPolicySelectorValue(toned, "tone", "professional")).toBe(original);
  });
});
