import { describe, expect, it } from "vitest";
import { inspectControlledDocument } from "./controlled-document-inspector.js";
import { splitHeadline } from "./header-lines.js";
import {
  buildRenderingQaReport,
  extractTextFromRenderedDocument,
  renderArtifact,
} from "./index.js";
import { renderPrintHtml } from "./print-html.js";
import { fixtureGeneratedAt, sectionOf, syntheticCv } from "./synthetic-cv.fixture.js";

describe("a headline that carries contact details (#1931)", () => {
  it("splits the name from an email, a phone number or a profile address", () => {
    expect(
      splitHeadline("Alex Example | alex@example.test | +00 00 00 00 00 |Sample City"),
    ).toEqual([
      { kind: "title", text: "Alex Example" },
      { kind: "contact", text: "alex@example.test | +00 00 00 00 00 |Sample City" },
    ]);
    expect(splitHeadline("Alex Example | +00 0000 0000")).toHaveLength(2);
    expect(splitHeadline("Alex Example | example.test/in/alex · github.com/alex")).toHaveLength(2);
  });

  it("keeps a headline whole when the rest holds no contact detail or the name is not a name", () => {
    for (const text of [
      "Alex Example",
      "Alex Example | Senior Platform Engineer",
      "Alex Example, Senior Platform Engineer",
      "alex@example.test | +00 0000 0000",
      "A very long headline about many things | alex@example.test",
      " | alex@example.test",
    ]) {
      expect(splitHeadline(text)).toEqual([{ kind: "title", text }]);
    }
  });

  const oneLineHeader = (() => {
    const cv = syntheticCv(1, 2);
    return {
      ...cv,
      sections: cv.sections.map((section) =>
        section.kind === "header"
          ? sectionOf("header", "header", 0, [
              {
                type: "paragraph" as const,
                text: "Alex Example | alex@example.test | +00 00 00 00 00 00 | Sample City",
              },
            ])
          : section,
      ),
    };
  })();

  it("draws the name alone at the name size and passes rendering QA in every format", () => {
    for (const templateId of ["classic", "compact", "modern"]) {
      for (const format of ["pdf", "docx"] as const) {
        const rendered = renderArtifact(oneLineHeader, format, {
          generatedAt: fixtureGeneratedAt,
          templateId,
        });
        const report = buildRenderingQaReport({
          artifact: oneLineHeader,
          rendered,
          createdAt: fixtureGeneratedAt,
          viewerObservation: inspectControlledDocument(rendered),
        });
        expect(report.contentIntegrity, `${templateId} ${format}`).toMatchObject({
          visibleContentMatches: true,
          sectionOrderMatches: true,
          blockOrderMatches: true,
        });
        expect(extractTextFromRenderedDocument(rendered)).toContain(
          "Alex Example alex@example.test",
        );
      }
    }
  });

  it("prints the name and the contact line as separate units", () => {
    const html = renderPrintHtml(oneLineHeader, { templateId: "modern" });
    expect(html).toMatch(/<h1[^>]*>Alex Example<\/h1>/u);
    expect(html).toMatch(/<p[^>]*contact[^>]*>alex@example\.test \| /u);
    expect(html).toContain("<title>Alex Example, CV</title>");
  });
});
