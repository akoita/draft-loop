import { randomUUID } from "node:crypto";
import type { SourceSensitivityRule } from "@draft-loop/domain/source-sensitivity";
import {
  parsePullRequestList,
  pullRequestListMarkdown,
} from "@draft-loop/ingestion/pull-request-list";
import { describe, expect, it } from "vitest";

import { filterSourceTextForCanonicalProfile } from "./canonical-profile-sensitivity-filter.js";
import type { HostedSensitivityRules } from "./hosted-sensitivity-rules.js";
import {
  applyPullRequestSensitivityDefaults,
  pullRequestRepositoryPath,
  repositoriesWithoutRules,
} from "./pull-request-sensitivity.js";

// Invented pull requests: one in an employer's private repository, one in a personal one.
const markdown = pullRequestListMarkdown(
  parsePullRequestList(
    JSON.stringify([
      {
        title: "Cache rendered invoices",
        body: "Confidential client billing change.",
        closedAt: "2026-09-14T10:00:00Z",
        url: "https://github.com/example-employer/billing/pull/42",
        repository: { nameWithOwner: "example-employer/billing" },
      },
      {
        title: "Add retry to the export job",
        body: "Public tooling.",
        closedAt: "2026-10-02T08:30:00Z",
        url: "https://github.com/sample-user/tools/pull/7",
        repository: { nameWithOwner: "sample-user/tools" },
      },
    ]),
    "application/json",
  ) ?? [],
);

function memoryRules(initial: SourceSensitivityRule[] = []) {
  const rules = [...initial];
  const port: Pick<HostedSensitivityRules, "list" | "add"> = {
    list: async (knowledgeBaseId) => ({
      knowledgeBaseId,
      version: 1,
      checksum: null,
      createdAt: null,
      rules,
    }),
    add: async (knowledgeBaseId, rule) => {
      rules.push({ id: randomUUID(), ...rule } as SourceSensitivityRule);
      return { knowledgeBaseId, version: 2, checksum: null, createdAt: null, rules };
    },
  };
  return { port, rules };
}

describe("pull request sensitivity defaults", () => {
  it("marks each imported repository sensitive, so it is withheld without consent", async () => {
    const { port, rules } = memoryRules();
    const added = await applyPullRequestSensitivityDefaults(port, "base-1", [
      "example-employer/billing",
      "sample-user/tools",
    ]);
    expect(added).toEqual(["example-employer/billing", "sample-user/tools"]);
    expect(rules.map((rule) => [rule.tier, rule.match])).toEqual([
      ["sensitive", { kind: "heading-path", path: ["Pull requests", "example-employer/billing"] }],
      ["sensitive", { kind: "heading-path", path: ["Pull requests", "sample-user/tools"] }],
    ]);
    const filtered = filterSourceTextForCanonicalProfile(markdown, "text/markdown", rules);
    expect(filtered.status).toBe("filtered");
    const kept = filtered.status === "filtered" ? filtered.text : "";
    expect(kept).not.toContain("Confidential client billing");
    expect(kept).not.toContain("Public tooling");
  });

  it("keeps a repository the person lowered to normal, and never puts its default back", async () => {
    const lowered = {
      id: "rule-lowered",
      tier: "normal",
      match: { kind: "heading-path", path: [...pullRequestRepositoryPath("sample-user/tools")] },
    } as SourceSensitivityRule;
    const { port, rules } = memoryRules([lowered]);
    await applyPullRequestSensitivityDefaults(port, "base-1", [
      "example-employer/billing",
      "sample-user/tools",
    ]);
    expect(repositoriesWithoutRules(rules, ["sample-user/tools"])).toEqual([]);
    const filtered = filterSourceTextForCanonicalProfile(markdown, "text/markdown", rules);
    const kept = filtered.status === "filtered" ? filtered.text : "";
    expect(kept).toContain("Public tooling");
    expect(kept).toContain("https://github.com/sample-user/tools/pull/7");
    expect(kept).not.toContain("Confidential client billing");
  });
});
