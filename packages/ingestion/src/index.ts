import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";

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

  const extractor = findExtractor(mediaType, options.extractors ?? []);
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
