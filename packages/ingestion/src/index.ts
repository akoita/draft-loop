import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { inflateRawSync, inflateSync } from "node:zlib";

export const supportedMediaTypes = [
  "text/plain",
  "text/markdown",
  "text/html",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

export type SupportedMediaType = (typeof supportedMediaTypes)[number];
export type BinaryMediaType = Extract<
  SupportedMediaType,
  "application/pdf" | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
>;

const mediaTypeByExtension: Readonly<Record<string, SupportedMediaType>> = {
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".htm": "text/html",
  ".html": "text/html",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".pdf": "application/pdf",
  ".text": "text/plain",
  ".txt": "text/plain",
};

export interface IngestionSource {
  readonly path: string;
  readonly mediaType?: string;
}

export interface SourceLocator {
  readonly lineStart: number;
  readonly lineEnd: number;
}

export interface SourceChunk {
  readonly id: string;
  readonly sourcePath: string;
  readonly mediaType: SupportedMediaType;
  readonly checksum: string;
  readonly locator: SourceLocator;
  readonly text: string;
}

export type IngestionIssueCode =
  | "unsupported-media-type"
  | "extractor-unavailable"
  | "read-failure"
  | "parse-failure"
  | "empty-content";

export interface IngestionIssue {
  readonly code: IngestionIssueCode;
  readonly sourcePath: string;
  readonly message: string;
  readonly recoverable: boolean;
}

export interface NormalizedSource {
  readonly source: IngestionSource;
  readonly mediaType: SupportedMediaType;
  readonly checksum: string;
  readonly text: string;
  readonly chunks: readonly SourceChunk[];
  readonly issues: readonly IngestionIssue[];
}

export interface IngestionResult {
  readonly source: NormalizedSource | null;
  readonly issues: readonly IngestionIssue[];
}

export interface IngestionBatchResult {
  readonly sources: readonly NormalizedSource[];
  readonly issues: readonly IngestionIssue[];
}

export interface ExtractorInput {
  readonly source: IngestionSource;
  readonly mediaType: BinaryMediaType;
  readonly bytes: Uint8Array;
  readonly checksum: string;
}

export interface BinarySourceExtractor {
  readonly mediaType: BinaryMediaType;
  readonly extract: (input: ExtractorInput) => string | Promise<string>;
}

export interface IngestionOptions {
  readonly maxChunkCharacters?: number;
  readonly extractors?: readonly BinarySourceExtractor[];
}

const maxBinaryBytes = 32 * 1024 * 1024;
const maxExtractedCharacters = 2_000_000;

export function detectMediaType(source: IngestionSource): SupportedMediaType | null {
  const explicitMediaType = source.mediaType?.split(";", 1)[0]?.trim().toLowerCase();
  if (explicitMediaType !== undefined && isSupportedMediaType(explicitMediaType)) {
    return explicitMediaType;
  }

  if (explicitMediaType !== undefined) {
    return null;
  }

  return mediaTypeByExtension[extname(source.path).toLowerCase()] ?? null;
}

function isSupportedMediaType(value: string): value is SupportedMediaType {
  return (supportedMediaTypes as readonly string[]).includes(value);
}

function issue(code: IngestionIssueCode, sourcePath: string, message: string): IngestionIssue {
  return { code, sourcePath, message, recoverable: true };
}

function normalizeText(text: string): string {
  return text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .trimEnd();
}

function decodeHtmlEntities(text: string): string {
  const namedEntities: Readonly<Record<string, string>> = {
    amp: "&",
    apos: "'",
    gt: ">",
    laquo: "«",
    ldquo: "“",
    lt: "<",
    nbsp: " ",
    ndash: "–",
    quot: '"',
    rdquo: "”",
    rsquo: "’",
    shy: "-",
  };

  return text.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]+);/gi, (entity, value: string) => {
    if (value.toLowerCase().startsWith("#x")) {
      const codePoint = Number.parseInt(value.slice(2), 16);
      return Number.isNaN(codePoint) ? entity : String.fromCodePoint(codePoint);
    }
    if (value.startsWith("#")) {
      const codePoint = Number.parseInt(value.slice(1), 10);
      return Number.isNaN(codePoint) ? entity : String.fromCodePoint(codePoint);
    }
    return namedEntities[value.toLowerCase()] ?? entity;
  });
}

function extractHtml(text: string): string {
  const withoutInactiveContent = text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  const withBoundaries = withoutInactiveContent.replace(
    /<\/?(address|article|aside|blockquote|br|dd|div|dl|dt|footer|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|td|th|tr|ul)\b[^>]*>/gi,
    "\n",
  );
  return normalizeText(
    decodeHtmlEntities(withBoundaries.replace(/<[^>]*>/g, " "))
      .replace(/[ \t]+/g, " ")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/\n{2,}/g, "\n"),
  ).trim();
}

function readUint16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) |
      ((bytes[offset + 1] ?? 0) << 8) |
      ((bytes[offset + 2] ?? 0) << 16) |
      ((bytes[offset + 3] ?? 0) << 24)) >>>
    0
  );
}

function latin1Bytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    bytes[index] = value.charCodeAt(index) & 0xff;
  }
  return bytes;
}

function extractZipEntry(bytes: Uint8Array, entryName: string): string {
  if (bytes.length > maxBinaryBytes) {
    throw new Error("binary source exceeds the configured size limit");
  }
  const minimumEndRecord = 22;
  const searchStart = Math.max(0, bytes.length - 65_557);
  let endOffset = -1;
  for (let offset = bytes.length - minimumEndRecord; offset >= searchStart; offset -= 1) {
    if (
      bytes[offset] === 0x50 &&
      bytes[offset + 1] === 0x4b &&
      bytes[offset + 2] === 0x05 &&
      bytes[offset + 3] === 0x06
    ) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) throw new Error("ZIP end record is missing");

  const entryCount = readUint16(bytes, endOffset + 10);
  const directorySize = readUint32(bytes, endOffset + 12);
  const directoryOffset = readUint32(bytes, endOffset + 16);
  if (
    directoryOffset > bytes.length ||
    directorySize > bytes.length - directoryOffset ||
    entryCount > 10_000
  ) {
    throw new Error("ZIP directory is invalid");
  }

  let offset = directoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > bytes.length || readUint32(bytes, offset) !== 0x02014b50) {
      throw new Error("ZIP directory entry is invalid");
    }
    const flags = readUint16(bytes, offset + 8);
    const compression = readUint16(bytes, offset + 10);
    const compressedSize = readUint32(bytes, offset + 20);
    const uncompressedSize = readUint32(bytes, offset + 24);
    const nameLength = readUint16(bytes, offset + 28);
    const extraLength = readUint16(bytes, offset + 30);
    const commentLength = readUint16(bytes, offset + 32);
    const localOffset = readUint32(bytes, offset + 42);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    const name = new TextDecoder("utf-8", { fatal: true }).decode(bytes.slice(nameStart, nameEnd));
    offset = nameEnd + extraLength + commentLength;
    if (name !== entryName) continue;
    if ((flags & 0x1) !== 0) throw new Error("encrypted ZIP entries are not supported");
    if (uncompressedSize > maxExtractedCharacters || compressedSize > bytes.length) {
      throw new Error("ZIP entry exceeds the configured extraction limit");
    }
    if (localOffset + 30 > bytes.length || readUint32(bytes, localOffset) !== 0x04034b50) {
      throw new Error("ZIP local entry is invalid");
    }
    const localNameLength = readUint16(bytes, localOffset + 26);
    const localExtraLength = readUint16(bytes, localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    if (dataStart > bytes.length || compressedSize > bytes.length - dataStart) {
      throw new Error("ZIP entry data is truncated");
    }
    const compressed = bytes.slice(dataStart, dataStart + compressedSize);
    let content: Uint8Array;
    if (compression === 0) {
      content = compressed;
    } else if (compression === 8) {
      content = new Uint8Array(inflateRawSync(compressed));
    } else {
      throw new Error("ZIP compression method is not supported");
    }
    if (content.length > maxExtractedCharacters) {
      throw new Error("ZIP entry exceeds the configured extraction limit");
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(content);
  }
  throw new Error(`ZIP entry ${entryName} is missing`);
}

function extractDocx(bytes: Uint8Array): string {
  const xml = extractZipEntry(bytes, "word/document.xml");
  if (!/<(?:[a-z]+:)?document\b/u.test(xml)) throw new Error("DOCX document part is invalid");
  return normalizeText(
    decodeHtmlEntities(
      xml
        .replace(/<w:(?:tab|br)\b[^>]*\/?\s*>/gu, "\t")
        .replace(/<\/w:(?:p|tr)>/gu, "\n")
        .replace(/<[^>]*>/gu, "")
        .replace(/\t+/gu, " "),
    ),
  );
}

function decodePdfLiteral(value: string): string {
  let result = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character !== "\\") {
      result += character;
      continue;
    }
    const escaped = value[++index] ?? "";
    const escapes: Readonly<Record<string, string>> = {
      "\\": "\\",
      "(": "(",
      ")": ")",
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t",
    };
    if (escapes[escaped] !== undefined) {
      result += escapes[escaped];
      continue;
    }
    if (/[0-7]/u.test(escaped)) {
      const octal = `${escaped}${value[index + 1] ?? ""}${value[index + 2] ?? ""}`.match(
        /^[0-7]{1,3}/u,
      )?.[0];
      if (octal !== undefined) {
        result += String.fromCharCode(Number.parseInt(octal, 8));
        index += octal.length - 1;
        continue;
      }
    }
    if (escaped === "\n") continue;
    if (escaped === "\r" && value[index + 1] === "\n") index += 1;
  }
  return result;
}

function pdfString(value: string, start: number): { readonly value: string; readonly end: number } {
  let depth = 1;
  let index = start + 1;
  let raw = "";
  while (index < value.length) {
    const character = value[index];
    if (character === "\\") {
      raw += character;
      raw += value[index + 1] ?? "";
      index += 2;
      continue;
    }
    if (character === "(") depth += 1;
    if (character === ")") {
      depth -= 1;
      if (depth === 0) return { value: decodePdfLiteral(raw), end: index + 1 };
    }
    raw += character;
    index += 1;
  }
  throw new Error("PDF text string is unterminated");
}

function pdfArray(value: string, start: number): { readonly value: string; readonly end: number } {
  let index = start + 1;
  const strings: string[] = [];
  while (index < value.length) {
    const character = value[index];
    if (character === "]") return { value: strings.join(""), end: index + 1 };
    if (character === "(") {
      const parsed = pdfString(value, index);
      strings.push(parsed.value);
      index = parsed.end;
      continue;
    }
    index += 1;
  }
  throw new Error("PDF text array is unterminated");
}

function extractPdfOperators(content: string): string {
  let result = "";
  let index = 0;
  while (index < content.length) {
    const character = content[index];
    if (character === "(") {
      const parsed = pdfString(content, index);
      let cursor = parsed.end;
      while (/\s/u.test(content[cursor] ?? "")) cursor += 1;
      if (content.startsWith("Tj", cursor)) {
        result += `${parsed.value}\n`;
        index = cursor + 2;
        continue;
      }
      index = parsed.end;
      continue;
    }
    if (character === "[") {
      const parsed = pdfArray(content, index);
      let cursor = parsed.end;
      while (/\s/u.test(content[cursor] ?? "")) cursor += 1;
      if (content.startsWith("TJ", cursor)) {
        result += `${parsed.value}\n`;
        index = cursor + 2;
        continue;
      }
      index = parsed.end;
      continue;
    }
    index += 1;
  }
  return normalizeText(result);
}

function extractPdf(bytes: Uint8Array): string {
  if (bytes.length > maxBinaryBytes) throw new Error("PDF exceeds the configured size limit");
  const binary = Buffer.from(bytes).toString("latin1");
  if (!binary.startsWith("%PDF-")) throw new Error("PDF header is invalid");
  if (/\/Encrypt\b/u.test(binary)) throw new Error("encrypted PDFs are not supported");
  const textParts: string[] = [];
  const streams = /stream(?:\r\n|\n|\r)([\s\S]*?)(?:\r\n|\n|\r)endstream/gu;
  for (const match of binary.matchAll(streams)) {
    const stream = match[1] ?? "";
    const streamOffset = match.index ?? 0;
    const dictionary = binary.slice(Math.max(0, streamOffset - 1200), streamOffset);
    let decoded = latin1Bytes(stream);
    if (/\/FlateDecode\b/u.test(dictionary)) {
      decoded = new Uint8Array(inflateSync(decoded));
    }
    textParts.push(extractPdfOperators(Buffer.from(decoded).toString("latin1")));
  }
  const text = normalizeText(textParts.filter((part) => part !== "").join("\n"));
  if (text === "") throw new Error("PDF contains no extractable text");
  return text;
}

export const defaultBinaryExtractors: readonly BinarySourceExtractor[] = Object.freeze([
  { mediaType: "application/pdf", extract: ({ bytes }) => extractPdf(bytes) },
  {
    mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    extract: ({ bytes }) => extractDocx(bytes),
  },
]);

function checksum(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function chunkId(
  sourcePath: string,
  sourceChecksum: string,
  ordinal: number,
  chunkText: string,
): string {
  return createHash("sha256")
    .update(`${sourcePath}\u0000${sourceChecksum}\u0000${ordinal}\u0000${chunkText}`, "utf8")
    .digest("hex");
}

function createChunks(
  text: string,
  sourcePath: string,
  mediaType: SupportedMediaType,
  sourceChecksum: string,
  maxChunkCharacters: number,
): readonly SourceChunk[] {
  const lines = text.split("\n");
  while (lines.at(-1) === "") {
    lines.pop();
  }
  const chunks: SourceChunk[] = [];
  let buffer = "";
  let lineStart = 1;
  let lineEnd = 1;

  const appendChunk = (chunkText: string, start: number, end: number): void => {
    if (chunkText.length === 0) {
      return;
    }
    const ordinal = chunks.length;
    chunks.push({
      id: chunkId(sourcePath, sourceChecksum, ordinal, chunkText),
      sourcePath,
      mediaType,
      checksum: sourceChecksum,
      locator: { lineStart: start, lineEnd: end },
      text: chunkText,
    });
  };

  const flush = (): void => {
    appendChunk(buffer, lineStart, lineEnd);
    buffer = "";
  };

  lines.forEach((line, index) => {
    const currentLine = index + 1;
    if (line.trim() === "") {
      flush();
      lineStart = currentLine + 1;
      lineEnd = currentLine + 1;
      return;
    }
    if (line.length > maxChunkCharacters) {
      flush();
      for (let offset = 0; offset < line.length; offset += maxChunkCharacters) {
        appendChunk(line.slice(offset, offset + maxChunkCharacters), currentLine, currentLine);
      }
      lineStart = currentLine + 1;
      lineEnd = currentLine + 1;
      return;
    }

    const candidate = buffer.length === 0 ? line : `${buffer}\n${line}`;
    if (buffer.length > 0 && candidate.length > maxChunkCharacters) {
      flush();
      buffer = line;
      lineStart = currentLine;
      lineEnd = currentLine;
      return;
    }

    if (buffer.length === 0) {
      lineStart = currentLine;
    }
    buffer = candidate;
    lineEnd = currentLine;
  });
  flush();
  return chunks;
}

function findExtractor(
  mediaType: SupportedMediaType,
  extractors: readonly BinarySourceExtractor[],
): BinarySourceExtractor | undefined {
  return mediaType === "application/pdf" ||
    mediaType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ? extractors.find((extractor) => extractor.mediaType === mediaType)
    : undefined;
}

function safeErrorMessage(code: "read" | "parse", sourcePath: string): IngestionIssue {
  return issue(
    code === "read" ? "read-failure" : "parse-failure",
    sourcePath,
    code === "read" ? "The source file could not be read." : "The source file could not be parsed.",
  );
}

async function extractSource(
  source: IngestionSource,
  mediaType: SupportedMediaType,
  bytes: Uint8Array,
  sourceChecksum: string,
  options: IngestionOptions,
): Promise<{ readonly text: string; readonly issues: readonly IngestionIssue[] }> {
  if (mediaType === "text/plain" || mediaType === "text/markdown") {
    try {
      return {
        text: normalizeText(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
        issues: [],
      };
    } catch {
      return { text: "", issues: [safeErrorMessage("parse", source.path)] };
    }
  }

  if (mediaType === "text/html") {
    try {
      const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      return { text: extractHtml(decoded), issues: [] };
    } catch {
      return { text: "", issues: [safeErrorMessage("parse", source.path)] };
    }
  }

  if (bytes.length > maxBinaryBytes) {
    return {
      text: "",
      issues: [
        issue(
          "parse-failure",
          source.path,
          "The source file exceeds the configured binary extraction limit.",
        ),
      ],
    };
  }

  const extractor = findExtractor(
    mediaType,
    options.extractors === undefined ? defaultBinaryExtractors : options.extractors,
  );
  if (extractor === undefined) {
    return {
      text: "",
      issues: [
        issue(
          "extractor-unavailable",
          source.path,
          "No extractor is configured for this file type.",
        ),
      ],
    };
  }

  try {
    const extracted = await extractor.extract({
      source,
      mediaType,
      bytes,
      checksum: sourceChecksum,
    });
    if (typeof extracted !== "string") {
      return { text: "", issues: [safeErrorMessage("parse", source.path)] };
    }
    return { text: normalizeText(extracted), issues: [] };
  } catch {
    return { text: "", issues: [safeErrorMessage("parse", source.path)] };
  }
}

export async function ingestFile(
  source: IngestionSource,
  options: IngestionOptions = {},
): Promise<IngestionResult> {
  const mediaType = detectMediaType(source);
  if (mediaType === null) {
    const resultIssue = issue(
      "unsupported-media-type",
      source.path,
      "The source file type is not supported or could not be detected.",
    );
    return { source: null, issues: [resultIssue] };
  }

  let bytes: Uint8Array;
  try {
    bytes = await readFile(source.path);
  } catch {
    const resultIssue = safeErrorMessage("read", source.path);
    return { source: null, issues: [resultIssue] };
  }

  const sourceChecksum = checksum(bytes);
  const extracted = await extractSource(source, mediaType, bytes, sourceChecksum, options);
  const issues = [...extracted.issues];
  const text = extracted.text;
  if (text.length === 0 && extracted.issues.length === 0) {
    issues.push(
      issue("empty-content", source.path, "The source file contains no extractable text."),
    );
  }

  const maxChunkCharacters = options.maxChunkCharacters ?? 1200;
  if (!Number.isInteger(maxChunkCharacters) || maxChunkCharacters < 1) {
    throw new RangeError("maxChunkCharacters must be a positive integer.");
  }

  return {
    source: {
      source,
      mediaType,
      checksum: sourceChecksum,
      text,
      chunks: createChunks(text, source.path, mediaType, sourceChecksum, maxChunkCharacters),
      issues,
    },
    issues,
  };
}

export async function ingestSources(
  sources: readonly IngestionSource[],
  options: IngestionOptions = {},
): Promise<IngestionBatchResult> {
  const results = await Promise.all(sources.map((source) => ingestFile(source, options)));
  return {
    sources: results.flatMap((result) => (result.source === null ? [] : [result.source])),
    issues: results.flatMap((result) => result.issues),
  };
}
