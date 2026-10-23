import { describe, expect, it } from "vitest";

import { defaultRuleForm, describeRule, ruleRequest } from "./sensitivity-model.js";

describe("sensitivity rule model", () => {
  it("describes a rule in one line", () => {
    expect(
      describeRule({
        id: "notes",
        tier: "never-share",
        match: { kind: "heading-contains", text: "Private notes" },
      }),
    ).toBe('Never share · heading contains "Private notes"');
    expect(
      describeRule({
        id: "salary",
        tier: "sensitive",
        match: { kind: "heading-path", path: ["Experience", "Salary"] },
      }),
    ).toBe("Sensitive · under Experience › Salary");
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
