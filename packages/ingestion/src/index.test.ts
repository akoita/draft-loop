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

  it("reports binary formats without an extractor instead of decoding them as text", async () => {
    const secret = "CONFIDENTIAL-CANDIDATE-MATERIAL";
    const path = await fixture("resume.docx", new TextEncoder().encode(secret));

    const result = await ingestFile({ path });

    expect(result.source?.mediaType).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(result.issues).toMatchObject([{ code: "extractor-unavailable", recoverable: true }]);
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
