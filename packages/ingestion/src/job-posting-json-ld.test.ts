import { describe, expect, it } from "vitest";

import { htmlFragmentToMarkdown } from "./html-text.js";
import { ingestUrl } from "./index.js";
import { extractJobPostingText, maxJobPostingTextCharacters } from "./job-posting-json-ld.js";

const description =
  "<p>Join the platform team and keep our services reliable.</p>" +
  "<h2>What you will do</h2><ul><li>Run production systems &amp; on-call</li>" +
  "<li>Mentor engineers</li></ul>" +
  "<h2>Requirements</h2><ul><li><p>5+ years with TypeScript</p></li>" +
  "<li>Experience with PostgreSQL</li></ul>";

const posting = {
  "@context": "https://schema.org",
  "@type": "JobPosting",
  title: "Platform Engineer",
  hiringOrganization: { "@type": "Organization", name: "Example Systems" },
  description,
};

function shellPage(...blocks: readonly unknown[]): string {
  const scripts = blocks
    .map((block) => `<script type="application/ld+json">${JSON.stringify(block)}</script>`)
    .join("");
  return `<!doctype html><html><head><title>Jobs</title>${scripts}</head><body><div id="app"></div><noscript>You need to enable JavaScript to run this app.</noscript></body></html>`;
}

async function ingest(html: string, preferJobPostingData: boolean) {
  return ingestUrl("https://jobs.example.test/example/role", {
    preferJobPostingData,
    fetcher: async () =>
      new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } }),
    resolveHostname: async () => ["93.184.216.34"],
    now: () => new Date("2026-10-09T10:00:00.000Z"),
  });
}

describe("JobPosting JSON-LD", () => {
  it("turns a JavaScript shell page into the posting text, keeping headings and bullets", async () => {
    const result = await ingest(shellPage(posting), true);

    expect(result.issues).toEqual([]);
    expect(result.source?.textOrigin).toBe("job-posting-json-ld");
    expect(result.source?.text).toBe(
      [
        "# Platform Engineer",
        "",
        "Company: Example Systems",
        "",
        "Join the platform team and keep our services reliable.",
        "",
        "## What you will do",
        "",
        "- Run production systems & on-call",
        "- Mentor engineers",
        "",
        "## Requirements",
        "",
        "- 5+ years with TypeScript",
        "- Experience with PostgreSQL",
      ].join("\n"),
    );
    expect(result.source?.chunks.length).toBeGreaterThan(0);
  });

  it("finds a JobPosting inside @graph, an array, or a typed list", () => {
    for (const block of [
      { "@context": "https://schema.org", "@graph": [{ "@type": "WebSite" }, posting] },
      [{ "@type": "BreadcrumbList" }, posting],
      { ...posting, "@type": ["Thing", "JobPosting"] },
    ]) {
      expect(extractJobPostingText(shellPage(block))).toContain("## Requirements");
    }
  });

  it("reads an entity-escaped description and a string organisation", () => {
    const text = extractJobPostingText(
      shellPage({
        "@type": "JobPosting",
        title: "Data Engineer",
        hiringOrganization: "Example Systems",
        description:
          "&lt;p&gt;Build pipelines.&lt;/p&gt;&lt;ul&gt;&lt;li&gt;SQL&lt;/li&gt;&lt;/ul&gt;",
      }),
    );
    expect(text).toBe("# Data Engineer\n\nCompany: Example Systems\n\nBuild pipelines.\n\n- SQL");
  });

  it("ignores pages without a usable JobPosting and malformed blocks", () => {
    expect(extractJobPostingText("<html><body>Plain page</body></html>")).toBeNull();
    expect(extractJobPostingText(shellPage({ "@type": "Organization", name: "X" }))).toBeNull();
    expect(
      extractJobPostingText(
        '<script type="application/ld+json">{not json</script>' +
          '<script type="text/javascript">{"@type":"JobPosting","description":"x"}</script>',
      ),
    ).toBeNull();
    expect(extractJobPostingText(shellPage({ "@type": "JobPosting", title: "Empty" }))).toBeNull();
  });

  it("bounds the posting text", () => {
    const text = extractJobPostingText(
      shellPage({
        "@type": "JobPosting",
        title: "Long",
        description: `<p>${"word ".repeat(40_000)}</p>`,
      }),
    );
    expect(text?.length).toBeLessThanOrEqual(maxJobPostingTextCharacters);
  });

  it("leaves a server-rendered page unchanged, with or without the opt-in", async () => {
    const html =
      "<html><body><h1>Platform Engineer</h1><p>Keep services reliable.</p><ul><li>TypeScript</li></ul></body></html>";
    const plain = await ingest(html, false);
    const optedIn = await ingest(html, true);

    expect(plain.source?.text).toBe("# Platform Engineer\nKeep services reliable.\nTypeScript");
    expect(plain.source?.textOrigin).toBeUndefined();
    expect(optedIn.source?.text).toBe(plain.source?.text);
    expect(optedIn.source?.textOrigin).toBeUndefined();
  });

  it("uses the visible text unless the caller asks for JobPosting data", async () => {
    const result = await ingest(shellPage(posting), false);

    expect(result.source?.text).toBe("Jobs\nYou need to enable JavaScript to run this app.");
    expect(result.source?.textOrigin).toBeUndefined();
  });

  it("converts headings, bullets and entities", () => {
    expect(
      htmlFragmentToMarkdown("<h3>Title &amp; more</h3><p>One<br>Two</p><li>Item&nbsp;A</li>"),
    ).toBe("### Title & more\n\nOne\nTwo\n\n- Item A");
    expect(htmlFragmentToMarkdown("a &#99999999; b")).toBe("a &#99999999; b");
  });
});
