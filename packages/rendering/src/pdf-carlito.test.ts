import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { carlitoBold, carlitoRegular } from "./carlito-font-data.js";
import { textWidthPt } from "./document-layout.js";
import {
  extractTextFromRenderedDocument,
  inspectControlledDocument,
  type RenderedDocument,
  renderArtifact,
} from "./index.js";
import { embeddedFontFlateBytes } from "./pdf-fonts.js";
import { fixtureGeneratedAt, syntheticCv } from "./synthetic-cv.fixture.js";
import { parseTrueTypeFont } from "./truetype-font.js";
import { winAnsiCodePoint } from "./winansi.js";

const options = { generatedAt: fixtureGeneratedAt } as const;
const cv = syntheticCv(1.05);

function render(layoutProfile: "standard-two-page" | "compact-one-page"): RenderedDocument {
  return renderArtifact(cv, "pdf", { ...options, layoutProfile });
}

/** One byte per character, so string indexes are byte offsets. */
function latin1(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("latin1");
}

/** The bytes of an object's stream, located through its xref offset and its own `/Length`. */
function streamOf(pdf: Uint8Array, objectId: number): Uint8Array {
  const text = latin1(pdf);
  const xref = text.slice(text.lastIndexOf("\nxref\n") + 1);
  const offsets = [...xref.matchAll(/^(\d{10}) 00000 n $/gmu)].map((match) => Number(match[1]));
  const start = offsets[objectId - 1] ?? -1;
  const head = text.slice(start, start + 200);
  const length = Number(/\/Length (\d+)/u.exec(head)?.[1]);
  const dataStart = start + head.indexOf("stream\n") + "stream\n".length;
  expect(text.slice(dataStart + length, dataStart + length + "\nendstream".length)).toBe(
    "\nendstream",
  );
  return pdf.subarray(dataStart, dataStart + length);
}

describe("Carlito in the standard-two-page PDF", () => {
  const rendered = render("standard-two-page");
  const text = latin1(rendered.content);

  it("embeds Regular as F1 and Bold as F2 as WinAnsi TrueType simple fonts", () => {
    expect(text).toContain("/Subtype /TrueType /BaseFont /Carlito /Encoding /WinAnsiEncoding");
    expect(text).toContain("/BaseFont /Carlito-Bold ");
    expect(text).toContain("/FirstChar 32 /LastChar 255");
    expect(text).not.toContain("/Helvetica");
    expect(text.match(/\/FontFile2 \d+ 0 R/gu)).toHaveLength(2);
    expect(text.match(/\/Filter \/FlateDecode \/Length1 \d+ \/Length \d+/gu)).toHaveLength(2);
    expect(text).toContain("/F1 3 0 R /F2 4 0 R");
  });

  it("embeds the unmodified pinned fonts and writes the parser's widths", () => {
    const fontFiles = [...text.matchAll(/\/FontFile2 (\d+) 0 R/gu)].map((match) =>
      Number(match[1]),
    );
    const embedded = [carlitoRegular, carlitoBold];
    fontFiles.forEach((objectId, index) => {
      const data = embedded[index];
      if (data === undefined) throw new Error("unexpected font file");
      const font = new Uint8Array(inflateSync(streamOf(rendered.content, objectId)));
      expect(font.length).toBe(data.length1);
      expect(createHash("sha256").update(font).digest("hex")).toBe(data.sha256);

      const parsed = parseTrueTypeFont(font);
      const widths = Array.from({ length: 224 }, (_, offset) =>
        parsed.advanceWidth1000(winAnsiCodePoint(offset + 32)),
      );
      expect(widths).toEqual(data.widths);
      expect(text).toContain(`/Widths [${widths.join(" ")}]`);
      expect(embeddedFontFlateBytes(data).length).toBeLessThan(300_000);
    });
  });

  it("describes the fonts with real descriptor metrics", () => {
    const parsed = parseTrueTypeFont(
      new Uint8Array(inflateSync(embeddedFontFlateBytes(carlitoRegular))),
    );
    expect(parsed.metrics.unitsPerEm).toBe(2048);
    expect(carlitoRegular.ascent).toBe(parsed.metrics.ascent);
    expect(carlitoRegular.descent).toBeLessThan(0);
    expect(text).toMatch(/\/FontDescriptor[^>]*\/Flags 32 \/FontBBox \[-489 -258 1148 1015\]/u);
    expect(text).toContain(`/Ascent ${carlitoRegular.ascent} /Descent ${carlitoRegular.descent}`);
  });

  it("measures with Calibri-compatible advance widths, including WinAnsi specials", () => {
    // Calibri metrics: space 226, a 479, e 498, m 799 per 1000 em; Carlito is metric-compatible.
    const width = (value: string) => textWidthPt(value, 10, false, "carlito");
    expect(width(" ")).toBeCloseTo(2.26, 5);
    expect(width("a")).toBeCloseTo(4.79, 1);
    expect(width("m")).toBeCloseTo(7.99, 1);
    // The bullet, en dash and euro sit in the windows-1252 block and still measure.
    for (const special of ["•", "–", "€", "é"]) expect(width(special)).toBeGreaterThan(2);
    expect(textWidthPt("hello", 10, false, "carlito")).toBeLessThan(
      textWidthPt("hello", 10, false, "helvetica"),
    );
    expect(textWidthPt("hello", 10, true, "carlito")).toBeGreaterThan(
      textWidthPt("hello", 10, false, "carlito"),
    );
  });

  it("writes cross-reference offsets that point at each object, with binary streams", () => {
    const xrefStart = text.lastIndexOf("\nxref\n") + 1;
    expect(Number(/startxref\n(\d+)\n%%EOF\n$/u.exec(text)?.[1])).toBe(xrefStart);
    const size = Number(/trailer\n<< \/Size (\d+) /u.exec(text)?.[1]);
    const offsets = [...text.slice(xrefStart).matchAll(/^(\d{10}) 00000 n $/gmu)].map((match) =>
      Number(match[1]),
    );
    expect(offsets).toHaveLength(size - 1);
    expect(offsets.length).toBeGreaterThan(8);
    offsets.forEach((offset, index) => {
      expect(text.slice(offset, offset + `${index + 1} 0 obj\n`.length)).toBe(
        `${index + 1} 0 obj\n`,
      );
    });
  });

  it("still passes the inspector and recovers accents, punctuation and bold headings", () => {
    const observation = inspectControlledDocument(rendered);
    expect(observation.pageCount).toBe(2);
    expect(observation.clippedText).toBe(false);
    expect(observation.orphanSectionIds).toEqual([]);

    const accented = renderArtifact(
      {
        ...cv,
        sections: cv.sections.map((section) =>
          section.kind === "summary"
            ? {
                ...section,
                blocks: section.blocks.map((block, index) =>
                  index === 0 ? { ...block, text: "José’s café – 40% (€) • “quoted”" } : block,
                ),
              }
            : section,
        ),
      },
      "pdf",
      options,
    );
    expect(extractTextFromRenderedDocument(accented)).toContain("José’s café – 40% (€) • “quoted”");
    expect(inspectControlledDocument(accented).recoveredVisibleContentOrder).toBe("preserved");
  });

  it("stays well under one megabyte for a full two-page CV", () => {
    expect(rendered.content.length).toBeGreaterThan(400_000);
    expect(rendered.content.length).toBeLessThan(700_000);
  });
});

describe("compact-one-page PDF", () => {
  it("keeps the standard Helvetica fonts and embeds nothing", () => {
    const compact = renderArtifact(
      {
        ...cv,
        sections: cv.sections.slice(0, 2),
      },
      "pdf",
      { ...options, layoutProfile: "compact-one-page" },
    );
    const text = latin1(compact.content);
    expect(text).toContain("/Subtype /Type1 /BaseFont /Helvetica ");
    expect(text).toContain("/BaseFont /Helvetica-Bold ");
    expect(text).not.toContain("FontFile2");
    expect(text).not.toContain("Carlito");
    expect(compact.content.length).toBeLessThan(20_000);
    expect(inspectControlledDocument(compact).pageCount).toBe(1);
  });
});

describe("TrueType parser", () => {
  const regular = parseTrueTypeFont(
    new Uint8Array(inflateSync(embeddedFontFlateBytes(carlitoRegular))),
  );

  it("maps code points through cmap format 4 to hmtx advances", () => {
    expect(regular.hasGlyph(0x41)).toBe(true);
    expect(regular.hasGlyph(0xe9)).toBe(true);
    expect(regular.hasGlyph(0x4e2d)).toBe(false);
    expect(regular.advanceWidth1000(0x20)).toBe(226);
    expect(regular.advanceWidth1000(0x4e2d)).toBe(regular.advanceWidth1000(0xffff));
  });

  it("rejects bytes that are not a TrueType font", () => {
    expect(() => parseTrueTypeFont(new Uint8Array(64))).toThrow(/Unsupported TrueType font/u);
  });
});
