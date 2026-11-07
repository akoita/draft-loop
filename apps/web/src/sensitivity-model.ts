import { t } from "@lingui/core/macro";
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

/**
 * A rule as a sentence, such as `Never send sections whose heading contains "Salary"` or `Send only
 * if the workspace allows: sections under Health › Notes`.
 */
export function ruleSentence(rule: SensitivityRule): string {
  const lead: Readonly<Record<RuleTier, string>> = {
    "never-share": t`Never send`,
    sensitive: t`Send only if the workspace allows:`,
    normal: t`Always allow`,
  };
  const sections =
    rule.match.kind === "heading-contains"
      ? t`sections whose heading contains "${rule.match.text}"`
      : `sections under ${rule.match.path.join(" › ")}`;
  return `${lead[rule.tier]} ${sections}`;
}

type AddRuleBody = { tier: RuleTier; match: SensitivityRule["match"] };

/**
 * The repository a rule holds back, when it is an imported pull request repository's default
 * (#2262): `sensitive` on the heading path `Pull requests › owner/name`.
 */
export function pullRequestRepositoryOfRule(rule: SensitivityRule): string | undefined {
  if (rule.tier !== "sensitive" || rule.match.kind !== "heading-path") return undefined;
  const [top, repository, ...rest] = rule.match.path;
  return top === "Pull requests" && repository !== undefined && rest.length === 0
    ? repository
    : undefined;
}

/** The rule that lets a repository's pull requests be used: `normal` on the same path. */
export function allowRepositoryRequest(rule: SensitivityRule): AddRuleBody | undefined {
  if (pullRequestRepositoryOfRule(rule) === undefined || rule.match.kind !== "heading-path") {
    return undefined;
  }
  return { tier: "normal", match: { kind: "heading-path", path: [...rule.match.path] } };
}

/** The add-rule request, or what to fix first. */
export function ruleRequest(
  form: RuleForm,
): { readonly body: AddRuleBody } | { readonly problem: string } {
  if (form.kind === "heading-contains") {
    const text = form.heading.trim();
    if (text === "") return { problem: t`Name the heading text the rule matches.` };
    if (text.length > 200) return { problem: t`Keep the heading text to 200 characters or fewer.` };
    return { body: { tier: form.tier, match: { kind: "heading-contains", text } } };
  }
  const path = form.heading
    .split(">")
    .map((heading) => heading.trim())
    .filter((heading) => heading !== "");
  if (path.length === 0) return { problem: t`Name the headings, from the top level down.` };
  if (path.length > 12) return { problem: t`A heading path has at most 12 headings.` };
  if (path.some((heading) => heading.length > 200))
    return { problem: t`Keep each heading to 200 characters or fewer.` };
  return { body: { tier: form.tier, match: { kind: "heading-path", path } } };
}
