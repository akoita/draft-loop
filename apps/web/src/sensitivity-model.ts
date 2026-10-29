import type { ApiSchemas } from "./api-client.js";

export type SensitivityRule = ApiSchemas["SensitivityRule"];
type RuleTier = SensitivityRule["tier"];
type MatchKind = SensitivityRule["match"]["kind"];

/** The add-rule form as the owner fills it; a path's headings are separated by `>`. */
export interface RuleForm {
  readonly tier: Exclude<RuleTier, "normal">;
  readonly kind: MatchKind;
  readonly heading: string;
}

export const defaultRuleForm: RuleForm = {
  tier: "never-share",
  kind: "heading-contains",
  heading: "",
};

const tierLabels: Readonly<Record<RuleTier, string>> = {
  "never-share": "Never share",
  sensitive: "Sensitive",
  normal: "Normal",
};

/** A rule as one line, such as `Never share · heading contains "Salary"`. */
export function describeRule(rule: SensitivityRule): string {
  const match =
    rule.match.kind === "heading-contains"
      ? `heading contains "${rule.match.text}"`
      : `under ${rule.match.path.join(" › ")}`;
  return `${tierLabels[rule.tier]} · ${match}`;
}

/**
 * A rule as a sentence, such as `Never send sections whose heading contains "Salary"` or `Send only
 * if the workspace allows: sections under Health › Notes`.
 */
export function ruleSentence(rule: SensitivityRule): string {
  const lead: Readonly<Record<RuleTier, string>> = {
    "never-share": "Never send",
    sensitive: "Send only if the workspace allows:",
    normal: "Always allow",
  };
  const sections =
    rule.match.kind === "heading-contains"
      ? `sections whose heading contains "${rule.match.text}"`
      : `sections under ${rule.match.path.join(" › ")}`;
  return `${lead[rule.tier]} ${sections}`;
}

type AddRuleBody = { tier: RuleTier; match: SensitivityRule["match"] };

/** The add-rule request, or what to fix first. */
export function ruleRequest(
  form: RuleForm,
): { readonly body: AddRuleBody } | { readonly problem: string } {
  if (form.kind === "heading-contains") {
    const text = form.heading.trim();
    if (text === "") return { problem: "Name the heading text the rule matches." };
    if (text.length > 200) return { problem: "Keep the heading text to 200 characters or fewer." };
    return { body: { tier: form.tier, match: { kind: "heading-contains", text } } };
  }
  const path = form.heading
    .split(">")
    .map((heading) => heading.trim())
    .filter((heading) => heading !== "");
  if (path.length === 0) return { problem: "Name the headings, from the top level down." };
  if (path.length > 12) return { problem: "A heading path has at most 12 headings." };
  if (path.some((heading) => heading.length > 200))
    return { problem: "Keep each heading to 200 characters or fewer." };
  return { body: { tier: form.tier, match: { kind: "heading-path", path } } };
}
