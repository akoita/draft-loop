import type { UrlIngestionOptions } from "@draft-loop/ingestion";
import { describe, expect, it, vi } from "vitest";

import type { OpportunityExtractionRequest } from "./opportunity-extraction.js";
import {
  createOpportunityDraft,
  minimumJobPageTextCharacters,
  OpportunityJobPageUnreadableError,
  opportunityJobPageUnreadableMessage,
} from "./opportunity-intake.js";

const description =
  "<p>Join the platform team at Example Systems and keep our services reliable for customers around the world. We work in small teams, ship every day and care about calm, well-understood operations.</p>" +
  "<h2>What you will do</h2><ul><li>Run production systems and take part in the on-call rotation</li>" +
  "<li>Mentor engineers and review designs across several product teams</li></ul>" +
  "<h2>Requirements</h2><ul><li>5+ years of experience with TypeScript in production</li>" +
  "<li>Experience operating PostgreSQL at scale</li></ul>";

const shellStart =
  '<!doctype html><html><head><title>Jobs</title><script type="application/ld+json">';
const shellEnd =
  '</script></head><body><div id="app"></div><noscript>You need to enable JavaScript to run this app.</noscript></body></html>';

function shellPage(block: unknown): string {
  return `${shellStart}${JSON.stringify(block)}${shellEnd}`;
}

function urlOptions(html: string): UrlIngestionOptions {
  return {
    fetcher: async () =>
      new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } }),
    resolveHostname: async () => ["93.184.216.34"],
    now: () => new Date("2026-10-09T10:00:00.000Z"),
  };
}

const jobSource = {
  id: "job-source",
  kind: "approved-url" as const,
  classification: "job-posting" as const,
  url: "https://jobs.example.test/example/platform-engineer",
  approved: true,
};

describe("job pages rendered by JavaScript", () => {
  it("extracts from the JobPosting data and verifies excerpts against that text", async () => {
    const posting = {
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "WebSite" },
        {
          "@type": "JobPosting",
          title: "Platform Engineer",
          hiringOrganization: { name: "Example Systems" },
          description,
        },
      ],
    };
    const extract = vi.fn(async (request: OpportunityExtractionRequest) => {
      expect(request.sources[0]?.text).toContain("# Platform Engineer");
      expect(request.sources[0]?.text).toContain("- 5+ years of experience with TypeScript");
      return {
        schemaVersion: 1,
        role: { value: "Platform Engineer", sourceIds: ["job-source"] },
        employer: { value: "Example Systems", sourceIds: ["job-source"] },
        responsibilities: [],
        requirements: [
          {
            text: "TypeScript in production",
            priority: "critical",
            sourceIds: ["job-source"],
            excerpt: "5+ years of experience with TypeScript in production",
          },
          {
            text: "Invented requirement",
            priority: "medium",
            sourceIds: ["job-source"],
            excerpt: "Fluent in Haskell",
          },
        ],
        priorities: [],
        contradictions: [],
      };
    });

    const draft = await createOpportunityDraft(
      { id: "brief-js-page", createdAt: "2026-10-09T10:00:00.000Z", sources: [jobSource] },
      { urlIngestionOptions: urlOptions(shellPage(posting)), extractor: { extract } },
    );

    expect(extract).toHaveBeenCalledTimes(1);
    expect(draft.issues).toEqual([]);
    expect(draft.requirements).toHaveLength(2);
    expect(draft.requirements[0]?.excerpt).toBe(
      "5+ years of experience with TypeScript in production",
    );
    expect(draft.requirements[1]).not.toHaveProperty("excerpt");
    expect(draft.sources[0]?.status).toBe("available");
  });

  it("refuses a shell page without JobPosting data before any provider call", async () => {
    const extract = vi.fn();

    const attempt = createOpportunityDraft(
      { sources: [jobSource] },
      {
        urlIngestionOptions: urlOptions(shellPage({ "@type": "WebSite" })),
        extractor: { extract },
      },
    );

    await expect(attempt).rejects.toBeInstanceOf(OpportunityJobPageUnreadableError);
    await expect(attempt).rejects.toThrow(opportunityJobPageUnreadableMessage);
    expect(opportunityJobPageUnreadableMessage).toBe(
      "DraftLoop could not read enough job text from this page. It may show the job only with JavaScript. Paste the job text instead.",
    );
    expect(extract).not.toHaveBeenCalled();
  });

  it("reads a server-rendered page as before", async () => {
    const html = `<html><body><h1>Platform Engineer</h1>${description}</body></html>`;
    const extract = vi.fn(async (request: OpportunityExtractionRequest) => {
      expect(request.sources[0]?.text).toContain("Platform Engineer");
      expect(request.sources[0]?.text.length).toBeGreaterThanOrEqual(minimumJobPageTextCharacters);
      return {
        schemaVersion: 1,
        role: null,
        employer: null,
        responsibilities: [],
        requirements: [],
        priorities: [],
        contradictions: [],
      };
    });

    const draft = await createOpportunityDraft(
      { sources: [jobSource] },
      { urlIngestionOptions: urlOptions(html), extractor: { extract } },
    );

    expect(extract).toHaveBeenCalledTimes(1);
    expect(draft.requirements).toEqual([]);
  });

  it("does not apply the minimum to pasted job text", async () => {
    const draft = await createOpportunityDraft({
      sources: [
        {
          id: "job-source",
          kind: "pasted-content",
          classification: "job-posting",
          content: "Short note",
        },
      ],
    });

    expect(draft.sources).toHaveLength(1);
  });
});
