import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { classifyUrl, ingestFile, ingestSources, ingestUrl } from "./index.js";

const temporaryDirectories: string[] = [];

async function fixture(name: string, content: string | Uint8Array): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "draft-loop-ingestion-"));
  temporaryDirectories.push(directory);
  const path = join(directory, name);
  await writeFile(path, content);
  return path;
}

function pdfWithLiteral(literal: string): string {
  return `%PDF-1.4\n1 0 obj\n<< /Length 64 >>\nstream\nBT\n/F1 10 Tf\n(${literal}) Tj\nET\nendstream\nendobj\n%%EOF`;
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
    expect(first.source?.sizeBytes).toBe(
      new TextEncoder().encode("\uFEFFFirst line\r\nSecond line  \r\n\r\nThird line").byteLength,
    );
    expect(first.source?.chunks).toEqual(second.source?.chunks);
    expect(first.source?.chunks).toHaveLength(2);
    expect(first.source?.chunks[0]).toMatchObject({
      sourcePath: path,
      locator: { lineStart: 1, lineEnd: 2 },
      text: "First line\nSecond line",
    });
  });

  it("bounds a selected local source without changing accepted text behavior", async () => {
    const path = await fixture("bounded.txt", "bounded source");

    const accepted = await ingestFile({ path }, { maxSourceBytes: 14 });
    const oversized = await ingestFile({ path }, { maxSourceBytes: 13 });

    expect(accepted.issues).toEqual([]);
    expect(accepted.source?.text).toBe("bounded source");
    expect(oversized.source).toBeNull();
    expect(oversized.issues).toEqual([
      {
        code: "source-too-large",
        sourcePath: path,
        message: "The source file exceeds the configured size limit.",
        recoverable: true,
      },
    ]);
  });

  it.each([0, -1, 1.5])("rejects invalid maxSourceBytes value %s", async (maxSourceBytes) => {
    const path = await fixture("invalid-limit.txt", "candidate source");

    await expect(ingestFile({ path }, { maxSourceBytes })).rejects.toThrow(
      /maxSourceBytes must be a positive integer/u,
    );
  });

  it("rejects non-regular local sources", async () => {
    const parent = await mkdtemp(join(tmpdir(), "draft-loop-ingestion-directory-"));
    temporaryDirectories.push(parent);
    const path = join(parent, "directory.txt");
    await mkdir(path);

    const result = await ingestFile({ path });

    expect(result.source).toBeNull();
    expect(result.issues).toMatchObject([{ code: "read-failure", sourcePath: path }]);
  });

  it.skipIf(process.platform === "win32")("rejects symbolic-link local sources", async () => {
    const target = await fixture("target.txt", "candidate source");
    const directory = await mkdtemp(join(tmpdir(), "draft-loop-ingestion-link-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "linked.txt");
    await symlink(target, path, "file");

    const result = await ingestFile({ path });

    expect(result.source).toBeNull();
    expect(result.issues).toMatchObject([{ code: "read-failure", sourcePath: path }]);
  });

  it("fails closed when a local source changes after it is read", async () => {
    const path = await fixture("changing.txt", "initial source");

    const result = await ingestFile(
      { path },
      {
        afterSourceRead: async () => writeFile(path, "changed source with a different size"),
      },
    );

    expect(result.source).toBeNull();
    expect(result.issues).toMatchObject([{ code: "read-failure", sourcePath: path }]);
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
    expect(result.source?.sizeBytes).toBe(4);
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

  it("accepts legitimate accented Unicode from PDF extraction", async () => {
    const pdfPath = await fixture("accented.pdf", pdfWithLiteral("R\\351sum\\351 and caf\\351"));

    const result = await ingestFile({ path: pdfPath });

    expect(result.issues).toEqual([]);
    expect(result.source?.text).toBe("Résumé and café");
    expect(result.source?.chunks).toHaveLength(1);
  });

  it("extracts text from PDF with ToUnicode CMap and hex string text operators", async () => {
    const cmapStream = `1 0 obj\n<< /Length 200 >>\nstream\n/CIDInit /ProcSet findresource begin 12 dict begin begincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n1 begincodespacerange <0000> <FFFF> endcodespacerange\n2 beginbfchar\n<0001> <004A>\n<0002> <0062>\nendbfchar\n1 beginbfrange\n<0003> <0004> <006F>\nendbfrange\nendcmap\nendstream\nendobj`;
    const textStream = `2 0 obj\n<< /Length 100 >>\nstream\nBT\n/F1 12 Tf\n<000100030002> Tj\n[ <0001> 10 <00030002> ] TJ\nET\nendstream\nendobj`;
    const pdfPath = await fixture("cmap_test.pdf", `%PDF-1.4\n${cmapStream}\n${textStream}\n%%EOF`);

    const result = await ingestFile({ path: pdfPath });
    expect(result.issues).toEqual([]);
    expect(result.source?.text).toContain("Job");
  });

  it("resiliently extracts text from PDFs with unclosed or trailing stream operators", async () => {
    const textStream = `1 0 obj\n<< /Length 100 >>\nstream\nBT\n/F1 12 Tf\n(Valid Senior Engineer text) Tj\n(Unclosed trailing string\nET\nendstream\nendobj`;
    const pdfPath = await fixture("unclosed_stream.pdf", `%PDF-1.4\n${textStream}\n%%EOF`);

    const result = await ingestFile({ path: pdfPath });
    expect(result.issues).toEqual([]);
    expect(result.source?.text).toContain("Valid Senior Engineer text");
  });

  it("rejects PDF extraction containing C0 or C1 controls before chunking", async () => {
    const c0Path = await fixture("control.pdf", pdfWithLiteral("Reliable\\001text"));
    const c1Path = await fixture("c1.pdf", pdfWithLiteral("Reliable\\200text"));

    for (const path of [c0Path, c1Path]) {
      const result = await ingestFile({ path });

      expect(result.issues).toMatchObject([{ code: "extracted-content-invalid" }]);
      expect(result.source?.text).toBe("");
      expect(result.source?.chunks).toEqual([]);
      const batch = await ingestSources([{ path }]);
      expect(batch.sources).toEqual([]);
      expect(batch.issues).toMatchObject([{ code: "extracted-content-invalid" }]);
    }
  });

  it("rejects high-confidence UTF-8-as-Latin-1 PDF mojibake before chunking", async () => {
    const path = await fixture("mojibake.pdf", pdfWithLiteral("Caf\\303\\251"));

    const result = await ingestFile({ path });

    expect(result.issues).toMatchObject([{ code: "extracted-content-invalid" }]);
    expect(result.source?.text).toBe("");
    expect(result.source?.chunks).toEqual([]);
    expect(result.issues[0]?.message).not.toContain("Caf");
    const batch = await ingestSources([{ path }]);
    expect(batch.sources).toEqual([]);
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

describe("URL source ingestion", () => {
  it("classifies URLs from only their parsed hostname and pathname", () => {
    expect(classifyUrl("https://github.com/ada/project?kind=job-description#profile")).toBe(
      "github",
    );
    expect(classifyUrl("https://www.credly.com/badges/123")).toBe("certification");
    expect(classifyUrl("https://www.linkedin.com/in/ada-lovelace")).toBe("profile");
    expect(classifyUrl("https://ada.example/portfolio")).toBe("portfolio");
    expect(classifyUrl("https://jobs.example/roles/engineer")).toBe("job-description");
    expect(classifyUrl("https://acme.myworkdayjobs.com/en-US/careers/job/123")).toBe(
      "job-description",
    );
    expect(classifyUrl("https://apply.smartrecruiters.com/acme/role/123")).toBe("job-description");
    expect(classifyUrl("https://example.com/about-me")).toBe("generic");
  });

  it("extracts typed GitHub facts from fetched Markdown with URL and line provenance", async () => {
    const originalUrl = "https://github.com/ada/atlas";
    const body = [
      "# Atlas Platform",
      "",
      "## Projects",
      "- Atlas API — event-driven reporting service",
      "",
      "## Technologies",
      "TypeScript, React, PostgreSQL",
      "",
      "## Credentials",
      "- AWS Certified Developer",
      "",
      "Dates: 2022-2024",
      "[Live demo](https://demo.example/atlas)",
    ].join("\n");
    const result = await ingestUrl(originalUrl, {
      fetcher: async () =>
        new Response(body, { headers: { "content-type": "text/markdown; charset=utf-8" } }),
      now: () => new Date("2026-08-13T10:03:00.000Z"),
    });

    expect(result.issues).toEqual([]);
    expect(result.source?.urlExtraction).toMatchObject({
      status: "extracted",
      confidence: expect.any(Number),
    });
    expect(result.source?.urlExtraction?.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "project",
          value: "Atlas Platform",
          sourceUrl: originalUrl,
          locator: { lineStart: 1, lineEnd: 1 },
          status: "extracted",
        }),
        expect.objectContaining({ kind: "technology", value: "TypeScript" }),
        expect.objectContaining({ kind: "technology", value: "React" }),
        expect.objectContaining({ kind: "technology", value: "PostgreSQL" }),
        expect.objectContaining({ kind: "credential", value: "AWS Certified Developer" }),
        expect.objectContaining({ kind: "date", value: "2022-2024" }),
        expect.objectContaining({
          kind: "link",
          value: "https://demo.example/atlas",
          label: "Live demo",
        }),
      ]),
    );
    expect(result.source?.urlExtraction?.facts.every((fact) => fact.confidence > 0)).toBe(true);
    expect(result.source?.chunks[0]?.url).toEqual(result.source?.url);
  });

  it("extracts roles, dates, credentials, technologies, and links from static career HTML", async () => {
    const originalUrl = "https://careers.example/jobs/platform";
    const body = [
      "<main>",
      "<h1>Senior Platform Engineer</h1>",
      "<p>Role: Senior Platform Engineer</p>",
      "<p>Dates: Jan 2021 - Present</p>",
      "<h2>Requirements</h2>",
      "<ul><li>TypeScript and Docker</li></ul>",
      "<h2>Credentials</h2>",
      "<ul><li>BSc Computer Science</li></ul>",
      '<a href="https://jobs.example/apply/platform">Apply for this role</a>',
      "</main>",
    ].join("");
    const result = await ingestUrl(originalUrl, {
      fetcher: async () =>
        new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } }),
    });

    expect(result.issues).toEqual([]);
    expect(result.source?.urlExtraction?.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "role", value: "Senior Platform Engineer" }),
        expect.objectContaining({ kind: "date", value: "Jan 2021" }),
        expect.objectContaining({ kind: "credential", value: "BSc Computer Science" }),
        expect.objectContaining({ kind: "technology", value: "TypeScript" }),
        expect.objectContaining({ kind: "technology", value: "Docker" }),
        expect.objectContaining({
          kind: "link",
          value: "https://jobs.example/apply/platform",
          label: "Apply for this role",
        }),
      ]),
    );
    expect(
      result.source?.urlExtraction?.facts.every((fact) => fact.sourceUrl === originalUrl),
    ).toBe(true);
  });

  it("uses the typed adapter for certification, profile, and portfolio sources", async () => {
    const fixtures = [
      {
        url: "https://www.credly.com/badges/example-developer",
        body: '<h1>AWS Certified Developer</h1><p>Issued: January 2024</p><p>Credential ID: CERT-123</p><a href="https://www.credly.com/badges/example-developer">View credential</a>',
        expected: { kind: "credential", value: "AWS Certified Developer" },
      },
      {
        url: "https://www.linkedin.com/in/example-person",
        body: '<h1>Example Person</h1><p>Role: Principal Engineer</p><p>Technologies: Python, PostgreSQL</p><p>Dates: 2020-2024</p><a href="https://example.com/profile">Profile site</a>',
        expected: { kind: "role", value: "Principal Engineer" },
      },
      {
        url: "https://example.com/portfolio",
        body: '<h1>Atlas Portfolio</h1><h2>Projects</h2><ul><li>Atlas dashboard</li></ul><h2>Technologies</h2><ul><li>React</li></ul><a href="https://demo.example/atlas">Live demo</a>',
        expected: { kind: "project", value: "Atlas Portfolio" },
      },
    ] as const;

    for (const fixture of fixtures) {
      const result = await ingestUrl(fixture.url, {
        fetcher: async () =>
          new Response(fixture.body, { headers: { "content-type": "text/html; charset=utf-8" } }),
      });

      expect(result.issues).toEqual([]);
      expect(result.source?.url?.kind).not.toBe("generic");
      expect(result.source?.urlExtraction?.status).toBe("extracted");
      expect(result.source?.urlExtraction?.facts).toEqual(
        expect.arrayContaining([expect.objectContaining(fixture.expected)]),
      );
    }
  });

  it("falls back to generic extraction for dynamic career pages without useful static facts", async () => {
    const result = await ingestUrl("https://careers.example/jobs/platform", {
      fetcher: async () =>
        new Response(
          "<html><head><script>window.__JOB_DATA__ = { title: 'Private role' };</script></head><body><div id=app></div></body></html>",
          { headers: { "content-type": "text/html; charset=utf-8" } },
        ),
      now: () => new Date("2026-08-13T10:04:00.000Z"),
    });

    expect(result.source?.text).toBe("");
    expect(result.source?.urlExtraction).toEqual({
      status: "generic-fallback",
      confidence: 0.25,
      facts: [],
    });
    expect(result.source?.url?.kind).toBe("job-description");
    expect(result.source?.urlExtraction?.facts).toEqual([]);
  });

  it("requires approval before invoking the injected fetcher and preserves URL provenance", async () => {
    let calls = 0;
    const notApproved = await ingestUrl("https://example.com/profile", {
      approval: false,
      fetcher: async () => {
        calls += 1;
        return new Response("should not be fetched");
      },
    });

    expect(notApproved.source).toBeNull();
    expect(notApproved.issues).toMatchObject([{ code: "approval-required" }]);
    expect(calls).toBe(0);

    const originalUrl = "https://www.linkedin.com/in/ada-lovelace";
    const fetchedAt = new Date("2026-08-13T10:00:00.000Z");
    const seen: {
      input?: string | undefined;
      redirect?: RequestRedirect | undefined;
      signal?: AbortSignal | null | undefined;
    } = {};
    const result = await ingestUrl(originalUrl, {
      approval: async () => true,
      fetcher: async (input, init) => {
        seen.input = input;
        seen.redirect = init?.redirect;
        seen.signal = init?.signal;
        return new Response("<h1>Ada Lovelace</h1><p>Mathematician</p>", {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      },
      now: () => fetchedAt,
    });

    expect(seen.input).toBe(originalUrl);
    expect(seen.redirect).toBe("manual");
    expect(seen.signal).toBeInstanceOf(AbortSignal);
    expect(result.issues).toEqual([]);
    expect(result.source).toMatchObject({
      mediaType: "text/html",
      text: "Ada Lovelace\nMathematician",
      url: {
        originalUrl,
        finalUrl: originalUrl,
        fetchedAt: fetchedAt.toISOString(),
        kind: "profile",
      },
      source: { path: originalUrl },
    });
    expect(result.source?.chunks[0]?.url).toEqual(result.source?.url);
    expect(result.source?.source.url).toEqual(result.source?.url);
  });

  it("retains exact URL response bytes whose checksum and size describe the body", async () => {
    const body = new Uint8Array([65, 66, 67, 194, 162]);
    const result = await ingestUrl("https://example.com/bytes", {
      fetcher: async () => new Response(body, { headers: { "content-type": "text/plain" } }),
      now: () => new Date("2026-08-13T10:00:00.000Z"),
    });

    expect(result.issues).toEqual([]);
    expect(result.source?.urlResponseBytes).toEqual(body);
    expect(result.source?.urlResponseBytes).not.toBe(body);
    expect(result.source?.sizeBytes).toBe(body.byteLength);
    expect(result.source?.checksum).toBe(createHash("sha256").update(body).digest("hex"));
    const local = await fixture("local.txt", "same text");
    const localResult = await ingestFile({ path: local });
    expect(localResult.source?.urlResponseBytes).toBeUndefined();
  });

  it("accepts an at-sign in a URL path or query without treating it as credentials", async () => {
    const url = "https://example.com/path/@candidate?contact=ada@example.com";
    const result = await ingestUrl(url, {
      fetcher: async (input) => {
        expect(input).toBe(url);
        return new Response("candidate evidence", {
          headers: { "content-type": "text/plain" },
        });
      },
    });

    expect(result.issues).toEqual([]);
    expect(result.source?.url?.originalUrl).toBe(url);
  });

  it("follows safe redirects, records the final URL, and revalidates redirect targets", async () => {
    const calls: string[] = [];
    const result = await ingestUrl("https://example.com/start", {
      fetcher: async (input) => {
        calls.push(input);
        if (input.endsWith("/start")) {
          return new Response(null, {
            status: 302,
            headers: { location: "/profile" },
          });
        }
        return new Response("Final profile", {
          headers: { "content-type": "text/plain" },
        });
      },
      now: () => new Date("2026-08-13T10:01:00.000Z"),
    });

    expect(calls).toEqual(["https://example.com/start", "https://example.com/profile"]);
    expect(result.issues).toEqual([]);
    expect(result.source?.url).toMatchObject({
      originalUrl: "https://example.com/start",
      finalUrl: "https://example.com/profile",
    });

    let redirectCalls = 0;
    const redirectLimit = await ingestUrl("https://example.com/one", {
      maxRedirects: 1,
      fetcher: async () => {
        redirectCalls += 1;
        return new Response(null, {
          status: 302,
          headers: { location: `https://example.com/${redirectCalls + 1}` },
        });
      },
    });
    expect(redirectLimit.source).toBeNull();
    expect(redirectLimit.issues).toMatchObject([{ code: "redirect-limit" }]);
    expect(redirectCalls).toBe(2);

    const unsafeRedirectCalls: string[] = [];
    const unsafeRedirect = await ingestUrl("https://example.com/start", {
      fetcher: async (input) => {
        unsafeRedirectCalls.push(input);
        return new Response(null, {
          status: 302,
          headers: { location: "http://127.0.0.1/private" },
        });
      },
    });

    expect(unsafeRedirect.source).toBeNull();
    expect(unsafeRedirect.issues).toMatchObject([{ code: "unsafe-url" }]);
    expect(unsafeRedirectCalls).toEqual(["https://example.com/start"]);
  });

  it("rejects unsafe URLs before the fetcher is called", async () => {
    const unsafeUrls = [
      "http://example.com/profile",
      "https://user:password@example.com/profile",
      "https://example.com/profile#fragment",
      "https://localhost/profile",
      "https://127.0.0.1/profile",
      "https://10.0.0.8/profile",
      "https://169.254.169.254/latest/meta-data",
      "https://[::1]/profile",
      "https://[fd00::1]/profile",
      "https://[fe80::1]/profile",
    ];
    let calls = 0;
    for (const url of unsafeUrls) {
      const result = await ingestUrl(url, {
        fetcher: async () => {
          calls += 1;
          return new Response("unexpected", { headers: { "content-type": "text/plain" } });
        },
      });
      expect(result.source).toBeNull();
      expect(result.issues).toMatchObject([{ code: "unsafe-url" }]);
    }
    expect(calls).toBe(0);

    let dnsCalls = 0;
    const dnsRebinding = await ingestUrl("https://public.example/profile", {
      resolveHostname: async () => ["192.168.1.20"],
      fetcher: async () => {
        dnsCalls += 1;
        return new Response("unexpected", { headers: { "content-type": "text/plain" } });
      },
    });
    expect(dnsRebinding.source).toBeNull();
    expect(dnsRebinding.issues).toMatchObject([{ code: "unsafe-url" }]);
    expect(dnsCalls).toBe(0);
  });

  it("bounds response bytes and extracted text without exposing response bodies", async () => {
    const tooLarge = await ingestUrl("https://example.com/large.txt", {
      maxResponseBytes: 3,
      fetcher: async () =>
        new Response("private-response-body", {
          headers: { "content-type": "text/plain" },
        }),
    });
    expect(tooLarge.source).toBeNull();
    expect(tooLarge.issues).toMatchObject([{ code: "response-too-large" }]);
    expect(tooLarge.issues[0]?.message).not.toContain("private-response-body");

    const tooMuchText = await ingestUrl("https://example.com/profile", {
      maxExtractedCharacters: 3,
      fetcher: async () =>
        new Response("private-response-body", {
          headers: { "content-type": "text/plain" },
        }),
    });
    expect(tooMuchText.source?.text).toBe("");
    expect(tooMuchText.issues).toMatchObject([{ code: "extracted-content-too-large" }]);
    expect(tooMuchText.issues[0]?.message).not.toContain("private-response-body");
  });

  it("reports timeout and fetch failures using sanitized issues", async () => {
    const timeout = await ingestUrl("https://example.com/slow", {
      timeoutMs: 1,
      fetcher: () => new Promise<Response>(() => undefined),
    });
    expect(timeout.source).toBeNull();
    expect(timeout.issues).toMatchObject([{ code: "fetch-timeout" }]);

    const secret = "PRIVATE-RESPONSE-BODY";
    const failure = await ingestUrl("https://example.com/failure", {
      fetcher: async () => {
        throw new Error(secret);
      },
    });
    expect(failure.source).toBeNull();
    expect(failure.issues).toMatchObject([{ code: "fetch-failure" }]);
    expect(failure.issues[0]?.message).not.toContain(secret);
  });

  it("accepts supported text content types and rejects non-text responses", async () => {
    const html = await ingestUrl("https://example.com/profile", {
      fetcher: async () =>
        new Response("<p>Visible</p><script>PRIVATE</script>", {
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
    });
    expect(html.issues).toEqual([]);
    expect(html.source?.mediaType).toBe("text/html");
    expect(html.source?.text).toBe("Visible");

    const unsupported = await ingestUrl("https://example.com/data", {
      fetcher: async () =>
        new Response('{"private":true}', {
          headers: { "content-type": "application/json" },
        }),
    });
    expect(unsupported.source).toBeNull();
    expect(unsupported.issues).toMatchObject([{ code: "unsupported-content-type" }]);
    expect(unsupported.issues[0]?.message).not.toContain("private");
  });

  it("keeps content checksums and chunk IDs stable for identical URL responses", async () => {
    const body = "First line\nSecond line";
    const options = {
      fetcher: async () => new Response(body, { headers: { "content-type": "text/plain" } }),
      now: () => new Date("2026-08-13T10:02:00.000Z"),
      maxChunkCharacters: 64,
    };
    const first = await ingestUrl("https://example.com/evidence.txt", options);
    const second = await ingestUrl("https://example.com/evidence.txt", options);

    expect(first.issues).toEqual([]);
    expect(second.issues).toEqual([]);
    expect(first.source?.checksum).toBe(second.source?.checksum);
    expect(first.source?.chunks).toEqual(second.source?.chunks);
  });
});
