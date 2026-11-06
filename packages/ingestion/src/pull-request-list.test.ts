import { partitionMarkdownSections } from "@draft-loop/domain/source-sensitivity";
import { describe, expect, it } from "vitest";

import { parsePullRequestList, pullRequestListMarkdown } from "./pull-request-list.js";

// Invented pull requests, in the shape `gh search prs --json title,body,closedAt,url,repository` prints.
const ghJson = JSON.stringify([
  {
    title: "Cache rendered invoices",
    body: "Invoices render once per change.\n## Not a heading\nCut render time from 900 ms to 120 ms.",
    closedAt: "2026-09-14T10:00:00Z",
    url: "https://github.com/example-org/billing/pull/42",
    repository: { name: "billing", nameWithOwner: "example-org/billing" },
  },
  {
    title: "Add retry to the export job",
    body: "",
    closedAt: "2026-10-02T08:30:00Z",
    url: "https://github.com/sample-user/tools/pull/7",
    repository: { name: "tools", nameWithOwner: "sample-user/tools" },
  },
]);

describe("pull request list import", () => {
  it("reads the JSON gh prints and writes one heading per pull request under its repository", () => {
    const list = parsePullRequestList(ghJson, "application/json");
    expect(list).toHaveLength(2);
    const markdown = pullRequestListMarkdown(list ?? []);
    const paths = partitionMarkdownSections(markdown).map((section) =>
      section.headingPath.join(" > "),
    );
    expect(paths).toEqual([
      "Pull requests",
      "Pull requests > example-org/billing",
      "Pull requests > example-org/billing > Cache rendered invoices",
      "Pull requests > sample-user/tools",
      "Pull requests > sample-user/tools > Add retry to the export job",
    ]);
    expect(markdown).toContain("- Merged: 2026-09-14");
    expect(markdown).toContain("- Link: https://github.com/example-org/billing/pull/42");
    expect(markdown).toContain("\\## Not a heading");
  });

  it("reads a CSV with the same columns, quoted fields included", () => {
    const csv = [
      "title,body,closedAt,url,repository",
      '"Fix pagination, again","Off by one ""page"" bug.\nNow tested.",2026-08-01,https://github.com/example-org/api/pull/3,example-org/api',
    ].join("\r\n");
    expect(parsePullRequestList(csv, "text/csv")).toEqual([
      {
        title: "Fix pagination, again",
        body: 'Off by one "page" bug.\nNow tested.',
        date: "2026-08-01",
        url: "https://github.com/example-org/api/pull/3",
        repository: "example-org/api",
      },
    ]);
  });

  it("refuses anything that is not a pull request list", () => {
    expect(parsePullRequestList("{}", "application/json")).toBeUndefined();
    expect(parsePullRequestList("[]", "application/json")).toBeUndefined();
    expect(parsePullRequestList("not json", "application/json")).toBeUndefined();
    expect(
      parsePullRequestList(
        JSON.stringify([{ title: "x", url: "https://example.test/x" }]),
        "application/json",
      ),
    ).toBeUndefined();
    expect(parsePullRequestList("name,email\nA,b@example.test", "text/csv")).toBeUndefined();
  });
});
