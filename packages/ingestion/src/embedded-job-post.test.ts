import { describe, expect, it } from "vitest";

import { extractEmbeddedJobPostText } from "./embedded-job-post.js";
import { extractJobPostingText } from "./job-posting-json-ld.js";

/** A fictional posting, entity-escaped as a Greenhouse-shaped board embeds it in route data. */
const escapedContent =
  "&lt;p&gt;Example Ledger is a fictional company that keeps accounts for small cooperatives.&lt;/p&gt;" +
  "&lt;h2&gt;What you bring&lt;/h2&gt;&lt;ul&gt;" +
  "&lt;li&gt;Five years of backend engineering with Node.js and PostgreSQL.&lt;/li&gt;" +
  "&lt;li&gt;Experience operating services on a managed Kubernetes platform.&lt;/li&gt;" +
  "&lt;li&gt;Clear writing for design reviews and runbooks.&lt;/li&gt;&lt;/ul&gt;";

function greenhouseShapedPage(content = escapedContent): string {
  const state = {
    state: {
      loaderData: {
        root: { locale: "en" },
        "routes/$url_token_.jobs_.$job_post_id": {
          jobPost: {
            id: 1234567,
            title: "Platform Engineer",
            company_name: "Example Ledger",
            job_post_location: "Remote, Europe",
            content,
          },
        },
      },
    },
  };
  return `<!doctype html><html><head><title>Job Application for Platform Engineer</title></head>
<body><div id="root"><h1>Platform Engineer</h1><p>Apply</p></div>
<script>window.__remixContext = ${JSON.stringify(state)};</script></body></html>`;
}

describe("job posts embedded in a JavaScript job board's page state (#2857)", () => {
  it("reads a Greenhouse-shaped board's job post as Markdown with its requirements", () => {
    const text = extractEmbeddedJobPostText(greenhouseShapedPage());

    expect(text).toContain("# Platform Engineer");
    expect(text).toContain("Company: Example Ledger");
    expect(text).toContain("Location: Remote, Europe");
    expect(text).toContain("Five years of backend engineering with Node.js and PostgreSQL.");
    expect(text).toMatch(/What you bring/u);
  });

  it("is what a job posting fetch reads when the page has no JSON-LD", () => {
    expect(extractJobPostingText(greenhouseShapedPage())).toBe(
      extractEmbeddedJobPostText(greenhouseShapedPage()),
    );
  });

  it("finds nothing in a page without embedded state or with a too short post", () => {
    expect(extractEmbeddedJobPostText("<html><body><h1>Jobs</h1></body></html>")).toBeNull();
    expect(
      extractEmbeddedJobPostText(greenhouseShapedPage("&lt;p&gt;Short.&lt;/p&gt;")),
    ).toBeNull();
  });

  it("skips embedded state that is not JSON", () => {
    const page =
      "<html><body><script>window.__remixContext = buildContext();</script></body></html>";
    expect(extractEmbeddedJobPostText(page)).toBeNull();
  });
});
