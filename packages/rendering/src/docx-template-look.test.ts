import type { DraftArtifact } from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";

import {
  builtInPdfDrawsTemplateLook,
  extractTextFromRenderedDocument,
  getRenderingTemplate,
  inspectControlledDocument,
  type RenderedDocument,
  renderArtifact,
  validateAtsExtractability,
} from "./index.js";
import { fixtureGeneratedAt, sectionOf } from "./synthetic-cv.fixture.js";

/** A fictional CV with a role context line, a labelled paragraph and bullets. */
const artifact: DraftArtifact = {
  schemaVersion: 1,
  id: "artifact-docx-look",
  version: 1,
  parentVersionId: null,
  createdAt: fixtureGeneratedAt,
  language: "en",
  sections: [
    sectionOf("header", "header", 0, [
      { type: "paragraph", text: "Robin Placeholder, Platform Engineer" },
      { type: "paragraph", text: "Sample City | robin@example.test" },
    ]),
    sectionOf("summary", "summary", 1, [
      { type: "paragraph", text: "Engineer who builds calm, observable delivery pipelines." },
    ]),
    sectionOf("experience", "experience", 2, [
      {
        type: "paragraph",
        text: "Example Works | Staff Engineer | Jan 2021 to present, Sample City",
      },
      { type: "paragraph", text: "Internal developer platform for a fictional retailer." },
      { type: "bullet", text: "Cut release lead time from two days to four hours." },
      { type: "bullet", text: "Mentored a team of five engineers through an on-call rotation." },
    ]),
    sectionOf("skills", "skills", 3, [
      {
        type: "paragraph",
        text: "Delivery: continuous integration, release automation, rollbacks.",
      },
    ]),
  ],
  claims: [],
  decisions: [],
};

const renderOptions = { generatedAt: fixtureGeneratedAt, allowUnbackedClaims: true };

/** The text parts of a stored (uncompressed) ZIP, which is what the DOCX writer produces. */
function storedZipParts(content: Uint8Array): ReadonlyMap<string, string> {
  const view = new DataView(content.buffer, content.byteOffset, content.byteLength);
  const decoder = new TextDecoder();
  const parts = new Map<string, string>();
  let offset = 0;
  while (offset + 30 <= content.length && view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    parts.set(
      decoder.decode(content.subarray(nameStart, nameStart + nameLength)),
      decoder.decode(content.subarray(dataStart, dataStart + size)),
    );
    offset = dataStart + size;
  }
  return parts;
}

function docxParts(templateId: string): {
  readonly rendered: RenderedDocument;
  readonly document: string;
  readonly styles: string;
} {
  const rendered = renderArtifact(artifact, "docx", { ...renderOptions, templateId });
  const parts = storedZipParts(rendered.content);
  return {
    rendered,
    document: parts.get("word/document.xml") ?? "",
    styles: parts.get("word/styles.xml") ?? "",
  };
}

/** One style's XML from styles.xml. */
function style(styles: string, id: string): string {
  return (
    styles.match(new RegExp(`<w:style [^>]*w:styleId="${id}">[\\s\\S]*?</w:style>`, "u"))?.[0] ?? ""
  );
}

/** The XML of the first body paragraph whose text contains `text`. */
function paragraphWith(document: string, text: string): string {
  return (
    [...document.matchAll(/<w:p>[\s\S]*?<\/w:p>/gu)].find((match) =>
      match[0].includes(text),
    )?.[0] ?? ""
  );
}

describe("Modern DOCX look (#1412)", () => {
  const modern = docxParts("modern");

  it("left-aligns the name and contact line, with the print CSS's name colour", () => {
    expect(style(modern.styles, "Title")).toContain('<w:jc w:val="left"/>');
    expect(style(modern.styles, "Title")).toContain('<w:color w:val="1B2329"/>');
    expect(style(modern.styles, "Contact")).toContain('<w:jc w:val="left"/>');
  });

  it("draws headings uppercase in the teal accent with a teal rule, keeping the text as written", () => {
    const heading = style(modern.styles, "Heading1");
    expect(heading).toContain("<w:caps/>");
    expect(heading).toContain('<w:color w:val="0F6E5C"/>');
    expect(heading).toContain('w:color="0F6E5C"');
    expect(paragraphWith(modern.document, "Experience")).toContain(">Experience</w:t>");
  });

  it("justifies body text and keeps role headers left so the date tab holds", () => {
    expect(style(modern.styles, "Normal")).toContain('<w:jc w:val="both"/>');
    expect(style(modern.styles, "Role")).toContain('<w:jc w:val="left"/>');
  });

  it("draws role dates bold in the accent colour", () => {
    expect(paragraphWith(modern.document, "Jan 2021 to present")).toContain(
      '<w:r><w:rPr><w:b/><w:color w:val="0F6E5C"/></w:rPr><w:t xml:space="preserve">Jan 2021 to present, Sample City</w:t></w:r>',
    );
  });

  it("puts the line under a role header in the italic context style", () => {
    expect(style(modern.styles, "RoleContext")).toContain("<w:i/>");
    expect(paragraphWith(modern.document, "Internal developer platform")).toContain(
      '<w:pStyle w:val="RoleContext"/>',
    );
  });

  it("hangs a labelled paragraph's later lines under its label", () => {
    expect(style(modern.styles, "Labelled")).toContain('w:hanging="220"');
    const labelled = paragraphWith(modern.document, "Delivery:");
    expect(labelled).toContain('<w:pStyle w:val="Labelled"/>');
    expect(labelled).toContain("<w:b/>");
  });

  it("passes the same rendering checks as Classic, with the same recovered text", () => {
    const classic = docxParts("classic");
    const modernObservation = inspectControlledDocument(modern.rendered);
    const classicObservation = inspectControlledDocument(classic.rendered);
    expect(modernObservation.recoveredVisibleContentOrder).toBe("preserved");
    expect(modernObservation.recoveredVisibleContentChecksum).toBe(
      classicObservation.recoveredVisibleContentChecksum,
    );
    expect(modernObservation.clippedText).toBe(false);
    expect(validateAtsExtractability(modern.rendered, artifact).passed).toBe(true);
    expect(extractTextFromRenderedDocument(modern.rendered)).toBe(
      extractTextFromRenderedDocument(classic.rendered),
    );
    expect(modern.rendered.metadata.renderingTemplate).toEqual({ id: "modern", version: 1 });
  });

  it("uses Modern's margins rather than Classic's", () => {
    // 13 mm and 11 mm in twips.
    expect(modern.document).toContain('w:top="624" w:right="737" w:bottom="624" w:left="737"');
  });
});

describe("Classic DOCX look", () => {
  it("keeps the centred name, plain headings, left text and no context style", () => {
    const classic = docxParts("classic");
    expect(style(classic.styles, "Title")).toContain('<w:jc w:val="center"/>');
    expect(classic.styles).not.toContain("<w:caps/>");
    expect(classic.styles).not.toContain('<w:jc w:val="both"/>');
    expect(classic.styles).not.toContain("RoleContext");
    expect(classic.styles).not.toContain("<w:color ");
    expect(classic.document).not.toContain("RoleContext");
  });
});

describe("built-in PDF writer and template looks", () => {
  it("draws Classic and Compact as designed, but not Modern", () => {
    expect(builtInPdfDrawsTemplateLook(getRenderingTemplate("classic"))).toBe(true);
    expect(builtInPdfDrawsTemplateLook(getRenderingTemplate("compact"))).toBe(true);
    expect(builtInPdfDrawsTemplateLook(getRenderingTemplate("modern"))).toBe(false);
  });
});
