import { describe, expect, it } from "vitest";

import { markDocxHeadings } from "./docx-headings.js";

const body = (...paragraphs: string[]) =>
  `<w:document><w:body>${paragraphs.join("")}</w:body></w:document>`;
const paragraph = (text: string, properties?: string) =>
  `<w:p>${properties === undefined ? "" : `<w:pPr>${properties}</w:pPr>`}<w:r><w:t>${text}</w:t></w:r></w:p>`;
const styleXml = (id: string, name: string, extra = "") =>
  `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/>${extra}</w:style>`;

describe("markDocxHeadings", () => {
  it("marks built-in Heading style ids without a styles part", () => {
    const xml = body(
      paragraph("Top", '<w:pStyle w:val="Heading1"/>'),
      paragraph("Sub", '<w:pStyle w:val="heading3"/>'),
      paragraph("Too deep", '<w:pStyle w:val="Heading7"/>'),
      paragraph("Plain"),
    );

    const marked = markDocxHeadings(xml);

    expect(marked).toContain('<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr># <w:r>');
    expect(marked).toContain("### <w:r><w:t>Sub");
    expect(marked).toContain("</w:pPr><w:r><w:t>Too deep");
    expect(marked.match(/#/gu)).toHaveLength(4);
    expect(marked).toContain("<w:p><w:r><w:t>Plain</w:t></w:r></w:p>");
  });

  it("maps localized style ids through the styles part", () => {
    const styles = `<w:styles>${styleXml("Titre1", "heading 1")}${styleXml("Corps", "Normal")}${styleXml("Custom", "Chapter", '<w:pPr><w:outlineLvl w:val="1"/></w:pPr>')}</w:styles>`;
    const xml = body(
      paragraph("Expérience", '<w:pStyle w:val="Titre1"/>'),
      paragraph("Chapter one", "<w:pStyle w:val='Custom'/>"),
      paragraph("Body", '<w:pStyle w:val="Corps"/>'),
    );

    const marked = markDocxHeadings(xml, styles);

    expect(marked).toContain("# <w:r><w:t>Expérience");
    expect(marked).toContain("## <w:r><w:t>Chapter one");
    expect(marked).not.toContain("# <w:r><w:t>Body");
  });

  it("lets a direct outline level win over the paragraph style", () => {
    const xml = body(
      paragraph("Direct", '<w:outlineLvl w:val="2"/>'),
      paragraph("Body text", '<w:pStyle w:val="Heading1"/><w:outlineLvl w:val="9"/>'),
    );

    const marked = markDocxHeadings(xml);

    expect(marked).toContain("### <w:r><w:t>Direct");
    expect(marked).not.toContain("# <w:r><w:t>Body text");
  });

  it("does not mark empty headings or run across self-closing paragraph parts", () => {
    const xml = body(
      '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr></w:p>',
      '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>  </w:t></w:r></w:p>',
      "<w:p/>",
      "<w:p><w:pPr/><w:r><w:t>Plain</w:t></w:r></w:p>",
      paragraph("Real", '<w:pStyle w:val="Heading2"/>'),
    );

    const marked = markDocxHeadings(xml);

    expect(marked.match(/#/gu)).toHaveLength(2);
    expect(marked).toContain("## <w:r><w:t>Real");
    expect(marked).toContain("<w:p><w:pPr/><w:r><w:t>Plain");
  });

  it("ignores style ids that do not name a heading and tolerates an unusable styles part", () => {
    const xml = body(paragraph("Note", '<w:pStyle w:val="Quote"/>'));

    expect(markDocxHeadings(xml, "not xml at all")).toBe(xml);
  });
});
