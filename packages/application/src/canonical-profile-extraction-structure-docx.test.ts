import { crc32 } from "node:zlib";

import { ingestBytes } from "@draft-loop/ingestion";
import { describe, expect, it } from "vitest";

import { planCanonicalProfileExtractionStructureWindows } from "./canonical-profile-extraction-structure.js";

const docxMediaType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const wordNamespace = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function littleEndian(value: number, length: number): Uint8Array {
  const result = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) result[index] = (value >>> (8 * index)) & 0xff;
  return result;
}

function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

/** Builds a one-entry stored ZIP, the smallest container the DOCX extractor accepts. */
function storedDocx(document: string): Uint8Array {
  const name = new TextEncoder().encode("word/document.xml");
  const content = new TextEncoder().encode(document);
  const checksum = littleEndian(crc32(content), 4);
  const local = concat(
    new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
    littleEndian(20, 2),
    new Uint8Array(8),
    checksum,
    littleEndian(content.length, 4),
    littleEndian(content.length, 4),
    littleEndian(name.length, 2),
    new Uint8Array(2),
    name,
    content,
  );
  const central = concat(
    new Uint8Array([0x50, 0x4b, 0x01, 0x02]),
    littleEndian(20, 2),
    littleEndian(20, 2),
    new Uint8Array(8),
    checksum,
    littleEndian(content.length, 4),
    littleEndian(content.length, 4),
    littleEndian(name.length, 2),
    new Uint8Array(16),
    name,
  );
  const end = concat(
    new Uint8Array([0x50, 0x4b, 0x05, 0x06]),
    new Uint8Array(4),
    littleEndian(1, 2),
    littleEndian(1, 2),
    littleEndian(central.length, 4),
    littleEndian(local.length, 4),
    new Uint8Array(2),
  );
  return concat(local, central, end);
}

function paragraph(text: string, style?: string): string {
  const properties = style === undefined ? "" : `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>`;
  return `<w:p>${properties}<w:r><w:t>${text}</w:t></w:r></w:p>`;
}

describe("structure windows for DOCX sources", () => {
  it("cuts a normalized DOCX at its heading paragraphs", async () => {
    const roles = ["Alpha", "Beta", "Gamma", "Delta"].flatMap((label) => [
      paragraph(`Platform engineer at ${label} Works Ltd, 2020-2024`, "Heading2"),
      ...Array.from({ length: 6 }, (_, index) =>
        paragraph(`${label} delivered synthetic migration number ${index} for Fictional Works.`),
      ),
    ]);
    const document = `<?xml version="1.0"?><w:document xmlns:w="${wordNamespace}"><w:body>${[
      paragraph("Intro paragraph before any heading."),
      paragraph("Experience", "Heading1"),
      ...roles,
    ].join("")}</w:body></w:document>`;

    const result = await ingestBytes(
      { path: "synthetic-resume.docx", mediaType: docxMediaType },
      storedDocx(document),
    );
    const text = result.source?.text ?? "";
    const limit = 700;
    const windows = planCanonicalProfileExtractionStructureWindows(text, limit);

    expect(result.issues).toEqual([]);
    expect(text).toContain("# Experience\n## Platform engineer at Alpha Works Ltd, 2020-2024\n");
    expect(windows).not.toBeNull();
    expect(windows?.length).toBeGreaterThan(2);
    windows?.forEach((window, index) => {
      expect(window.text.length).toBeLessThanOrEqual(limit);
      if (index === 0) expect(window.text.startsWith("Intro paragraph")).toBe(true);
      else expect(window.text).toMatch(/^#{1,6} /u);
    });
  });
});
