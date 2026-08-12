import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ingestFile, ingestSources } from "./index.js";

const temporaryDirectories: string[] = [];

async function fixture(name: string, content: string | Uint8Array): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "draft-loop-ingestion-"));
  temporaryDirectories.push(directory);
  const path = join(directory, name);
  await writeFile(path, content);
  return path;
}

function littleEndian(value: number, length: number): Uint8Array {
  const result = new Uint8Array(length);
  let remaining = value >>> 0;
  for (let index = 0; index < length; index += 1) {
    result[index] = remaining & 0xff;
    remaining >>>= 8;
  }
  return result;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
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

function storedDocx(document: string): Uint8Array {
  const name = new TextEncoder().encode("word/document.xml");
  const content = new TextEncoder().encode(document);
  const local = concat(
    new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
    littleEndian(20, 2),
    new Uint8Array(2),
    new Uint8Array(2),
    new Uint8Array(2),
    new Uint8Array(2),
    littleEndian(crc32(content), 4),
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
    littleEndian(crc32(content), 4),
    littleEndian(content.length, 4),
    littleEndian(content.length, 4),
    littleEndian(name.length, 2),
    new Uint8Array(2),
    new Uint8Array(2),
    new Uint8Array(2),
    new Uint8Array(2),
    new Uint8Array(4),
    new Uint8Array(4),
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

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe("local source ingestion", () => {
  it("normalizes text deterministically and preserves stable chunk provenance", async () => {
    const path = await fixture(
      "candidate.txt",
      "\uFEFFFirst line\r\nSecond line  \r\n\r\nThird line",
    );
    const first = await ingestFile({ path }, { maxChunkCharacters: 24 });
    const second = await ingestFile({ path }, { maxChunkCharacters: 24 });

    expect(first.issues).toEqual([]);
    expect(first.source?.mediaType).toBe("text/plain");
    expect(first.source?.text).toBe("First line\nSecond line\n\nThird line");
    expect(first.source?.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(first.source?.chunks).toEqual(second.source?.chunks);
    expect(first.source?.chunks).toHaveLength(2);
    expect(first.source?.chunks[0]).toMatchObject({
      sourcePath: path,
      locator: { lineStart: 1, lineEnd: 2 },
      text: "First line\nSecond line",
    });
  });

  it("extracts HTML text while removing inactive content and decoding entities", async () => {
    const path = await fixture(
      "profile.html",
      "<!-- hidden -->\n<html><head><style>SECRET-CANDIDATE</style><script>alert('ignore')</script></head><body><h1>Ada &amp; Grace</h1><p>Built &lt;systems&gt;.</p></body></html>",
    );

    const result = await ingestFile({ path });

    expect(result.issues).toEqual([]);
    expect(result.source?.text).toBe("Ada & Grace\nBuilt <systems>.");
    expect(result.source?.text).not.toContain("SECRET-CANDIDATE");
    expect(result.source?.text).not.toContain("alert");
  });

  it("uses an injected binary extractor without changing the provenance contract", async () => {
    const path = await fixture("resume.pdf", new Uint8Array([37, 80, 68, 70]));
    const observed: { bytes?: Uint8Array; checksum?: string } = {};

    const result = await ingestFile(
      { path },
      {
        extractors: [
          {
            mediaType: "application/pdf",
            extract: ({ bytes, checksum }) => {
              observed.bytes = bytes;
              observed.checksum = checksum;
              return "Experience\nBuilt reliable systems.";
            },
          },
        ],
      },
    );

    expect(result.issues).toEqual([]);
    expect(result.source?.mediaType).toBe("application/pdf");
    expect(result.source?.text).toBe("Experience\nBuilt reliable systems.");
    expect(new Uint8Array(observed.bytes ?? [])).toEqual(new Uint8Array([37, 80, 68, 70]));
    expect(observed.checksum).toBe(result.source?.checksum);
  });

  it("extracts text from local PDF and DOCX files with default safe extractors", async () => {
    const pdfPath = await fixture(
      "resume.pdf",
      `%PDF-1.4\n1 0 obj\n<< /Length 116 >>\nstream\nBT\n/F1 10 Tf 1 0 0 1 56 790 Tm (Experience) Tj\n/F1 10 Tf 1 0 0 1 56 774 Tm (Built reliable systems.) Tj\nET\nendstream\nendobj\n%%EOF`,
    );
    const docxPath = await fixture(
      "resume.docx",
      storedDocx(
        '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Ada &amp; Grace</w:t></w:r></w:p><w:p><w:r><w:t>Built reliable systems.</w:t></w:r></w:p></w:body></w:document>',
      ),
    );

    const pdfResult = await ingestFile({ path: pdfPath });
    const docxResult = await ingestFile({ path: docxPath });

    expect(pdfResult.issues).toEqual([]);
    expect(pdfResult.source?.text).toBe("Experience\nBuilt reliable systems.");
    expect(pdfResult.source?.chunks[0]?.locator).toEqual({ lineStart: 1, lineEnd: 2 });
    expect(docxResult.issues).toEqual([]);
    expect(docxResult.source?.text).toBe("Ada & Grace\nBuilt reliable systems.");
    expect(docxResult.source?.chunks[0]?.locator).toEqual({ lineStart: 1, lineEnd: 2 });
  });

  it("reports malformed binary formats without decoding them as text", async () => {
    const secret = "CONFIDENTIAL-CANDIDATE-MATERIAL";
    const path = await fixture("resume.docx", new TextEncoder().encode(secret));

    const result = await ingestFile({ path });

    expect(result.source?.mediaType).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(result.issues).toMatchObject([{ code: "parse-failure", recoverable: true }]);
    expect(result.issues[0]?.message).not.toContain(secret);
    expect(result.source?.text).toBe("");
    expect(result.source?.chunks).toEqual([]);
  });

  it("surfaces extractor and read failures without leaking source content", async () => {
    const secret = "PRIVATE-EMPLOYER-PROJECT";
    const path = await fixture("resume.pdf", new Uint8Array([1, 2, 3]));
    const parseResult = await ingestFile(
      { path },
      {
        extractors: [
          {
            mediaType: "application/pdf",
            extract: () => {
              throw new Error(secret);
            },
          },
        ],
      },
    );
    const readResult = await ingestFile({ path: `${path}.missing.txt` });

    expect(parseResult.issues[0]).toMatchObject({ code: "parse-failure" });
    expect(parseResult.issues[0]?.message).not.toContain(secret);
    expect(readResult.issues[0]).toMatchObject({ code: "read-failure" });
    expect(readResult.issues[0]?.message).not.toContain("missing");
  });

  it("rejects unknown types and keeps batch results in input order", async () => {
    const markdownPath = await fixture("notes.md", "# Notes\nUseful evidence");
    const textPath = await fixture("facts.txt", "Fact one");
    const batch = await ingestSources([
      { path: markdownPath },
      { path: textPath },
      { path: "unknown.xyz" },
    ]);

    expect(batch.sources.map((source) => source.source.path)).toEqual([markdownPath, textPath]);
    expect(batch.issues).toMatchObject([
      { code: "unsupported-media-type", sourcePath: "unknown.xyz" },
    ]);
  });

  it("accepts explicit media types before consulting the extension", async () => {
    const path = await fixture("profile.data", "Plain text supplied with an explicit type");
    const result = await ingestFile({ path, mediaType: "text/plain; charset=utf-8" });

    expect(result.source?.mediaType).toBe("text/plain");
    expect(result.source?.text).toBe("Plain text supplied with an explicit type");
  });

  it("does not retain a file handle after ingestion", async () => {
    const path = await fixture("readable.txt", "Readable source");
    const result = await ingestFile({ path });

    await rm(path);
    await expect(readFile(path)).rejects.toThrow();
    expect(result.source?.text).toBe("Readable source");
  });
});
