/**
 * Imported pull requests start `sensitive` (#2262): work in an employer's private repository may
 * be confidential, so it reaches a provider only when the workspace allows sensitive material. The
 * default is one heading-path rule per repository, `Pull requests › owner/name`, which the person
 * sees beside their other private-section rules. Lowering a repository replaces its rule with a
 * `normal` one ("Always allow"); since any rule on the path counts as the person's choice, a later
 * import of the same repository never puts the default back.
 */
import {
  normalizeHeadingText,
  type SourceSensitivityRule,
} from "@draft-loop/domain/source-sensitivity";
import { pullRequestListHeading } from "@draft-loop/ingestion/pull-request-list";

import type { HostedSensitivityRules } from "./hosted-sensitivity-rules.js";

export function pullRequestRepositoryPath(repository: string): readonly string[] {
  return [pullRequestListHeading, repository];
}

function samePath(rule: SourceSensitivityRule, path: readonly string[]): boolean {
  if (rule.match.kind !== "heading-path" || rule.match.path.length !== path.length) return false;
  return rule.match.path.every(
    (heading, index) => normalizeHeadingText(heading) === normalizeHeadingText(path[index] ?? ""),
  );
}

/** The repositories that have no rule of their own yet, in order, each once. */
export function repositoriesWithoutRules(
  rules: readonly SourceSensitivityRule[],
  repositories: readonly string[],
): readonly string[] {
  const missing: string[] = [];
  for (const repository of repositories) {
    const path = pullRequestRepositoryPath(repository);
    if (missing.includes(repository) || rules.some((rule) => samePath(rule, path))) continue;
    missing.push(repository);
  }
  return missing;
}

/** Adds the `sensitive` default for each imported repository without a rule; resolves with them. */
export async function applyPullRequestSensitivityDefaults(
  rules: Pick<HostedSensitivityRules, "list" | "add">,
  knowledgeBaseId: string,
  repositories: readonly string[],
): Promise<readonly string[]> {
  const missing = repositoriesWithoutRules((await rules.list(knowledgeBaseId)).rules, repositories);
  for (const repository of missing) {
    await rules.add(knowledgeBaseId, {
      tier: "sensitive",
      match: { kind: "heading-path", path: [...pullRequestRepositoryPath(repository)] },
    });
  }
  return missing;
}
