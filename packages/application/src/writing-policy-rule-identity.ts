import { createHash } from "node:crypto";

import type { WritingPolicyRule } from "@draft-loop/domain";

type WithoutWritingPolicyRuleId<T> = T extends unknown ? Omit<T, "id"> : never;
export type UnidentifiedWritingPolicyRule = WithoutWritingPolicyRuleId<WritingPolicyRule>;
export function compareWritingPolicySemantics(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
export function writingPolicyTermIdentity(term: string): string {
  return term.normalize("NFKC").replace(/\s+/gu, " ").toLowerCase();
}
export function writingPolicyRuleId(rule: UnidentifiedWritingPolicyRule): string {
  const semantics =
    rule.kind === "forbidden-term"
      ? `forbidden-term\u0000${
          rule.caseSensitive ? rule.term : writingPolicyTermIdentity(rule.term)
        }\u0000${String(rule.caseSensitive)}\u0000${String(rule.wholeWord)}`
      : `forbidden-characters\u0000${rule.characters}`;
  const digest = createHash("sha256").update(semantics, "utf8").digest("hex").slice(0, 24);
  return `writing-policy-${digest}`;
}
