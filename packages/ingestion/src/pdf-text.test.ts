import { deflateSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { extractPdfText } from "./pdf-text.js";

function cmap(entries: Readonly<Record<string, string>>): string {
  const lines = Object.entries(entries).map(
    ([code, character]) =>
      `<${code}> <${(character.codePointAt(0) ?? 0).toString(16).padStart(4, "0")}>`,
  );
  return `/CIDInit /ProcSet findresource begin 12 dict begin begincmap\n1 begincodespacerange <0000> <FFFF> endcodespacerange\n${lines.length} beginbfchar\n${lines.join("\n")}\nendbfchar\nendcmap`;
}

function stream(dictionary: string, data: string, flate = false): string {
  const bytes = flate ? deflateSync(Buffer.from(data, "latin1")).toString("latin1") : data;
  const filter = flate ? " /Filter /FlateDecode" : "";
  return `<< ${dictionary}${filter} /Length ${bytes.length} >>\nstream\n${bytes}\nendstream`;
}

function pdf(objects: Readonly<Record<number, string>>): Uint8Array {
  const body = Object.entries(objects)
    .map(([number, value]) => `${number} 0 obj\n${value}\nendobj`)
    .join("\n");
  return Buffer.from(`%PDF-1.4\n${body}\ntrailer\n<< /Root 1 0 R >>\n%%EOF`, "latin1");
}

// Two subset fonts reuse the same glyph codes for different characters, as browsers' PDFs do.
const parisFont = cmap({ "0001": "P", "0002": "a", "0003": "r", "0004": "i", "0005": "s" });
const franceFont = cmap({
  "0001": "F",
  "0002": "r",
  "0003": "a",
  "0004": "n",
  "0005": "c",
  "0006": "e",
});
const type0 = (name: string, toUnicode: number) =>
  `<< /Type /Font /Subtype /Type0 /BaseFont /${name} /Encoding /Identity-H /ToUnicode ${toUnicode} 0 R >>`;

describe("PDF text extraction", () => {
  it("decodes each text run with the ToUnicode map of the font it selects", () => {
    const content =
      "BT /F1 12 Tf 1 0 0 1 50 700 Tm <00010002000300040005> Tj ET\n" +
      "BT /F2 12 Tf 1 0 0 1 50 680 Tm [<000100020003> -20 <000400050006>] TJ ET\n" +
      "/X1 Do";
    const text = extractPdfText(
      pdf({
        1: "<< /Type /Catalog /Pages 2 0 R >>",
        2: "<< /Type /Pages /Kids [3 0 R] /Count 1 /Resources << /Font << /F1 4 0 R /F2 5 0 R >> /XObject << /X1 8 0 R >> >> >>",
        3: "<< /Type /Page /Parent 2 0 R /Contents 9 0 R >>",
        4: type0("AAAAAA+Sans", 6),
        5: type0("BAAAAA+Sans-Bold", 7),
        6: stream("", parisFont, true),
        7: stream("", franceFont),
        // The form names the second font /F1, so its text must use the form's own resources.
        8: stream(
          "/Type /XObject /Subtype /Form /Resources << /Font << /F1 5 0 R >> >>",
          "BT /F1 10 Tf 1 0 0 1 50 600 Tm <000100020003000400050006> Tj ET",
        ),
        9: stream("", content, true),
      }),
    );
    expect(text).toBe("Paris\nFrance\nFrance");
  });

  it("reads fonts kept in object streams and pages in page-tree order", () => {
    const fonts = [type0("AAAAAA+Sans", 6), type0("BAAAAA+Sans-Bold", 7)];
    const header = `4 0 5 ${fonts[0]?.length ?? 0} `;
    const text = extractPdfText(
      pdf({
        1: "<< /Type /Catalog /Pages 2 0 R >>",
        2: "<< /Type /Pages /Kids [11 0 R 3 0 R] /Count 2 >>",
        3: "<< /Type /Page /Parent 2 0 R /Resources << /Font << /F 5 0 R >> >> /Contents [9 0 R] >>",
        6: stream("", parisFont),
        7: stream("", franceFont),
        9: stream("", "BT /F 12 Tf <000100020003000400050006> Tj ET"),
        10: stream(
          `/Type /ObjStm /N 2 /First ${header.length}`,
          `${header}${fonts.join("")}`,
          true,
        ),
        11: "<< /Type /Page /Parent 2 0 R /Resources << /Font << /F 4 0 R >> >> /Contents 12 0 R >>",
        12: stream("", "BT /F 12 Tf <00010002000300040005> Tj ET"),
      }),
    );
    expect(text).toBe("Paris\nFrance");
  });

  it("maps Windows-1252 punctuation in single-byte fonts without a ToUnicode map", () => {
    const text = extractPdfText(
      pdf({
        1: "<< /Type /Catalog /Pages 2 0 R >>",
        2: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        3: "<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        4: "<< /Type /Font /Subtype /TrueType /BaseFont /Arial /Encoding /WinAnsiEncoding >>",
        5: stream("", "BT /F1 12 Tf (l\\222\\351quipe \\226 caf\\351) Tj ET"),
      }),
    );
    expect(text).toBe("l’équipe – café");
  });
});
