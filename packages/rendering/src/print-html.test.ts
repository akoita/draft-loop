import type { DraftArtifact } from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";

import { printUnitAttribute, renderPrintHtml } from "./print-html.js";

function block(id: string, type: "paragraph" | "bullet", text: string) {
  return { id, type, text, claimIds: [] };
}

const artifact: DraftArtifact = {
  schemaVersion: 1,
  id: "artifact-print",
  version: 1,
  parentVersionId: null,
  createdAt: "2026-10-17T09:00:00.000Z",
  language: "en",
  sections: [
    {
      id: "header",
      title: "Header",
      kind: "header",
      order: 0,
      blocks: [
        block("name", "paragraph", "Ada Lovelace"),
        block("contact", "paragraph", "London | ada@example.com"),
      ],
    },
    {
      id: "experience",
      title: "Experience",
      kind: "experience",
      order: 1,
      blocks: [
        block(
          "role",
          "paragraph",
          "Analytical Engines | Lead Engineer | Jan 2020 to present, London",
        ),
        block("b1", "bullet", "Designed the engine's control flow & the card reader."),
        block("b2", "bullet", "Security-first delivery: fixed every finding of the <audit>."),
        block("b3", "bullet", "Ran reviews."),
        block("b4", "bullet", "Wrote notes."),
        block("b5", "bullet", "Taught classes."),
        block("after", "paragraph", "Earlier work is listed below."),
      ],
    },
  ],
  claims: [],
  decisions: [],
};

const entities: Readonly<Record<string, string>> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
};

/** The text units the printing engine would report: each marked element's text content. */
function printedUnits(html: string): { kind: string; text: string }[] {
  const pattern = new RegExp(
    `<(h1|h2|p|li)[^>]*${printUnitAttribute}="(heading|body)"[^>]*>(.*?)</\\1>`,
    "gu",
  );
  return [...html.matchAll(pattern)].map((match) => ({
    kind: match[2] ?? "",
    text: (match[3] ?? "")
      .replace(/^<span class="bullet">• <\/span>/u, "")
      .replaceAll(/<[^>]+>/gu, "")
      .replaceAll(/&(?:amp|lt|gt|quot|#39);/gu, (entity) => entities[entity] ?? entity),
  }));
}

describe("print HTML", () => {
  it("marks every visible block with its exact text, in order", () => {
    const html = renderPrintHtml(artifact);
    expect(printedUnits(html)).toEqual([
      { kind: "heading", text: "Ada Lovelace" },
      { kind: "body", text: "London | ada@example.com" },
      { kind: "heading", text: "Experience" },
      ...artifact.sections[1]!.blocks.map((item) => ({ kind: "body", text: item.text })),
    ]);
  });

  it("keeps short bullets as bullets, each with a real glyph in a hanging indent", () => {
    const html = renderPrintHtml(artifact);
    expect(html).not.toContain(" · ");
    expect(html.match(/<li /gu)).toHaveLength(5);
    expect(html.match(/<span class="bullet">• <\/span>/gu)).toHaveLength(5);
    expect(html).toContain("text-indent:-10pt");
    expect(html).not.toMatch(/letter-spacing|text-transform/u);
  });

  it("titles the document with the candidate's name for the PDF metadata", () => {
    expect(renderPrintHtml(artifact)).toContain("<title>Ada Lovelace, CV</title>");
  });

  it("draws a role header with the dates apart and a bold label with its space", () => {
    const html = renderPrintHtml(artifact);
    expect(html).toContain(
      '<span class="role-title">Analytical Engines | Lead Engineer</span><span class="separator"> | </span><span class="date">Jan 2020 to present, London</span>',
    );
    expect(html).toContain("<strong>Security-first delivery:</strong> fixed every finding");
    expect(html).toContain("&lt;audit&gt;");
  });

  it("embeds both Carlito faces and takes the page and type from the template", () => {
    const classic = renderPrintHtml(artifact);
    expect(classic.match(/@font-face/gu)).toHaveLength(2);
    expect(classic).toContain("src:url(data:font/ttf;base64,");
    expect(classic).toContain("@page{size:A4;margin:10mm 12mm 10mm 12mm;}");
    expect(classic).toContain("font-size:9pt");
    const compact = renderPrintHtml(artifact, { templateId: "compact" });
    expect(compact).toContain("@page{size:A4;margin:12mm 12mm 12mm 12mm;}");
    expect(() => renderPrintHtml(artifact, { templateId: "modern" })).toThrow(RangeError);
  });
});
