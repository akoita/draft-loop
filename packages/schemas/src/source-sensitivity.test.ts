import type { SourceSensitivityRule } from "@draft-loop/domain/source-sensitivity";
import { defaultSourceSensitivityRuleSuggestions } from "@draft-loop/domain/source-sensitivity";
import { describe, expect, it } from "vitest";
import { sourceSensitivityRuleListSchema } from "./source-sensitivity.js";

const valid = {
  rules: [
    { id: "rule-1", tier: "never-share", match: { kind: "heading-contains", text: "  Salary " } },
    { id: "rule-2", tier: "sensitive", match: { kind: "heading-path", path: ["Work", "Phone"] } },
  ],
};

describe("sourceSensitivityRuleListSchema", () => {
  it("accepts a valid list and the default suggestions", () => {
    const parsed = sourceSensitivityRuleListSchema.parse(valid);
    const rules: readonly SourceSensitivityRule[] = parsed.rules;
    expect(rules).toHaveLength(2);
    expect(
      sourceSensitivityRuleListSchema.safeParse({
        rules: defaultSourceSensitivityRuleSuggestions,
      }).success,
    ).toBe(true);
    expect(sourceSensitivityRuleListSchema.safeParse({ rules: [] }).success).toBe(true);
  });

  it("rejects duplicate ids", () => {
    const rules = [valid.rules[0], { ...valid.rules[1], id: "rule-1" }];
    expect(sourceSensitivityRuleListSchema.safeParse({ rules }).success).toBe(false);
  });

  it("rejects oversize lists, ids, texts and paths", () => {
    const many = Array.from({ length: 201 }, (_, i) => ({
      id: `r${i}`,
      tier: "sensitive",
      match: { kind: "heading-contains", text: "x" },
    }));
    expect(sourceSensitivityRuleListSchema.safeParse({ rules: many }).success).toBe(false);
    expect(sourceSensitivityRuleListSchema.safeParse({ rules: many.slice(0, 200) }).success).toBe(
      true,
    );
    const rule = (patch: object) => ({ rules: [{ ...valid.rules[0], ...patch }] });
    expect(sourceSensitivityRuleListSchema.safeParse(rule({ id: "a".repeat(65) })).success).toBe(
      false,
    );
    expect(sourceSensitivityRuleListSchema.safeParse(rule({ id: "bad id!" })).success).toBe(false);
    expect(
      sourceSensitivityRuleListSchema.safeParse(
        rule({ match: { kind: "heading-contains", text: "a".repeat(201) } }),
      ).success,
    ).toBe(false);
    expect(
      sourceSensitivityRuleListSchema.safeParse(
        rule({ match: { kind: "heading-contains", text: "   " } }),
      ).success,
    ).toBe(false);
    expect(
      sourceSensitivityRuleListSchema.safeParse(rule({ match: { kind: "heading-path", path: [] } }))
        .success,
    ).toBe(false);
    expect(
      sourceSensitivityRuleListSchema.safeParse(
        rule({ match: { kind: "heading-path", path: Array.from({ length: 13 }, () => "h") } }),
      ).success,
    ).toBe(false);
    expect(
      sourceSensitivityRuleListSchema.safeParse(
        rule({ match: { kind: "heading-path", path: ["a".repeat(201)] } }),
      ).success,
    ).toBe(false);
  });

  it("rejects unknown tiers, unknown kinds and extra keys", () => {
    const rule = (patch: object) => ({ rules: [{ ...valid.rules[0], ...patch }] });
    expect(sourceSensitivityRuleListSchema.safeParse(rule({ tier: "secret" })).success).toBe(false);
    expect(
      sourceSensitivityRuleListSchema.safeParse(rule({ match: { kind: "regex", text: "x" } }))
        .success,
    ).toBe(false);
    expect(sourceSensitivityRuleListSchema.safeParse(rule({ extra: 1 })).success).toBe(false);
    expect(
      sourceSensitivityRuleListSchema.safeParse(
        rule({ match: { kind: "heading-contains", text: "x", extra: 1 } }),
      ).success,
    ).toBe(false);
    expect(sourceSensitivityRuleListSchema.safeParse({ ...valid, extra: 1 }).success).toBe(false);
  });
});
