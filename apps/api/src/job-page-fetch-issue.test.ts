import type { OpportunitySourceInput } from "@draft-loop/application";
import type { IngestionIssueCode } from "@draft-loop/ingestion";
import { describe, expect, it, vi } from "vitest";

import { fetchApprovedJobPage, type JobPageFetch } from "./job-page-brief.js";
import { jobPageFetchRefusal, jobPageHost } from "./job-page-fetch-issue.js";

const pageUrl = "https://jobs.example.test/platform-engineer?ref=private-token";
const sources = [
  {
    id: "job",
    kind: "approved-url",
    url: pageUrl,
    classification: "job-posting",
    approved: true,
  },
] as unknown as readonly OpportunitySourceInput[];

/** A fetch that read nothing and reports `code`, as the pinned fetcher does. */
function failedFetch(code: IngestionIssueCode | undefined): JobPageFetch {
  return {
    ingest: async () => ({ source: null, issues: [] }),
    page: () => undefined,
    issueCode: () => code,
  };
}

describe("a job page that cannot be read (#1836)", () => {
  const cases: readonly [IngestionIssueCode, string][] = [
    ["fetch-failure", "DraftLoop could not reach this job page."],
    ["unsafe-url", "DraftLoop only fetches public https pages"],
    ["fetch-timeout", "The job page took too long to answer."],
    ["response-too-large", "The job page is too large to read."],
    ["unsupported-content-type", "The address is not a web page DraftLoop can read."],
    ["redirect-limit", "The job page redirected too many times."],
    ["empty-content", "DraftLoop found no job text on this page."],
  ];

  for (const [code, message] of cases) {
    it(`logs ${code} with the host only and answers a matching message`, async () => {
      const warn = vi.fn();
      await expect(fetchApprovedJobPage(failedFetch(code), sources, { warn })).rejects.toThrow(
        message,
      );
      expect(warn).toHaveBeenCalledTimes(1);
      const [fields, line] = warn.mock.calls[0] ?? [];
      expect(line).toBe("job page fetch failed");
      expect(fields).toEqual({
        issueCode: code,
        host: "jobs.example.test",
        durationMs: expect.any(Number),
      });
      // Never the path, the query or anything the page said.
      expect(JSON.stringify(fields)).not.toContain("platform-engineer");
      expect(JSON.stringify(fields)).not.toContain("private-token");
    });
  }

  it("treats a fetch with no issue and no text as an empty page", async () => {
    const warn = vi.fn();
    await expect(fetchApprovedJobPage(failedFetch(undefined), sources, { warn })).rejects.toThrow(
      "DraftLoop found no job text on this page.",
    );
    expect(warn.mock.calls[0]?.[0]).toMatchObject({ issueCode: "empty-content" });
  });

  it("gives every code a next step and keeps the host to its name", () => {
    expect(jobPageFetchRefusal(undefined)).toContain("paste the job text instead");
    expect(jobPageHost(pageUrl)).toBe("jobs.example.test");
    expect(jobPageHost("not a url")).toBeNull();
  });
});
