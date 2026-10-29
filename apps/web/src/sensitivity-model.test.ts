import { describe, expect, it } from "vitest";

import { defaultRuleForm, ruleRequest, ruleSentence } from "./sensitivity-model.js";

describe("sensitivity rule model", () => {
  it("reads each tier and match kind as a sentence", () => {
    const contains = { kind: "heading-contains", text: "Salary" } as const;
    const path = { kind: "heading-path", path: ["Health", "Notes"] } as const;
    const sentence = (
      tier: "never-share" | "sensitive" | "normal",
      match: typeof contains | typeof path,
    ) => ruleSentence({ id: "rule", tier, match });

    expect(sentence("never-share", contains)).toBe(
      'Never send sections whose heading contains "Salary"',
    );
    expect(sentence("never-share", path)).toBe("Never send sections under Health › Notes");
    expect(sentence("sensitive", contains)).toBe(
      'Send only if the workspace allows: sections whose heading contains "Salary"',
    );
    expect(sentence("sensitive", path)).toBe(
      "Send only if the workspace allows: sections under Health › Notes",
    );
    expect(sentence("normal", path)).toBe("Always allow sections under Health › Notes");
  });

  it("builds a heading-contains rule from trimmed text", () => {
    expect(ruleRequest({ ...defaultRuleForm, heading: "  Private notes " })).toEqual({
      body: { tier: "never-share", match: { kind: "heading-contains", text: "Private notes" } },
    });
  });

  it("splits a heading path on > and drops empty parts", () => {
    expect(
      ruleRequest({ tier: "sensitive", kind: "heading-path", heading: "Experience > > Salary" }),
    ).toEqual({
      body: { tier: "sensitive", match: { kind: "heading-path", path: ["Experience", "Salary"] } },
    });
  });

  it("says what to fix before sending", () => {
    expect(ruleRequest(defaultRuleForm)).toEqual({
      problem: "Name the heading text the rule matches.",
    });
    expect(ruleRequest({ ...defaultRuleForm, kind: "heading-path", heading: " > " })).toEqual({
      problem: "Name the headings, from the top level down.",
    });
    expect(
      ruleRequest({
        ...defaultRuleForm,
        kind: "heading-path",
        heading: Array(13).fill("H").join(">"),
      }),
    ).toEqual({ problem: "A heading path has at most 12 headings." });
  });
});
