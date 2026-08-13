import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { readFile } from "node:fs/promises";
import { isIP } from "node:net";
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

export const urlSourceKinds = [
  "github",
  "certification",
  "profile",
  "portfolio",
  "job-description",
  "generic",
] as const;

export type UrlSourceKind = (typeof urlSourceKinds)[number];

export const urlFactKinds = [
  "project",
  "technology",
  "role",
  "date",
  "credential",
  "link",
] as const;

export type UrlFactKind = (typeof urlFactKinds)[number];

export const urlExtractionStatuses = ["extracted", "generic-fallback"] as const;

export type UrlExtractionStatus = (typeof urlExtractionStatuses)[number];

export interface UrlProvenance {
  readonly originalUrl: string;
  readonly finalUrl: string;
  readonly fetchedAt: string;
  readonly kind: UrlSourceKind;
}

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
  readonly url?: UrlProvenance;
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
  readonly url?: UrlProvenance;
}

export interface UrlSourceFact {
  readonly kind: UrlFactKind;
  readonly value: string;
  readonly sourceUrl: string;
  readonly locator: SourceLocator;
  readonly status: UrlExtractionStatus;
  /** A deterministic adapter confidence from 0 (weak) to 1 (strong). */
  readonly confidence: number;
  readonly label?: string;
}

export interface UrlExtraction {
  readonly status: UrlExtractionStatus;
  /** Aggregate confidence for the adapter result, from 0 (weak) to 1 (strong). */
  readonly confidence: number;
  readonly facts: readonly UrlSourceFact[];
}

export type IngestionIssueCode =
  | "unsupported-media-type"
  | "extractor-unavailable"
  | "read-failure"
  | "parse-failure"
  | "empty-content"
  | "approval-required"
  | "unsafe-url"
  | "redirect-limit"
  | "fetch-timeout"
  | "response-too-large"
  | "fetch-failure"
  | "unsupported-content-type"
  | "extracted-content-too-large";

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
  readonly url?: UrlProvenance;
  readonly urlExtraction?: UrlExtraction;
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

export type UrlFetcher = (input: string, init?: RequestInit) => Promise<Response>;
export type UrlHostnameResolver = (hostname: string) => Promise<readonly string[]>;

export interface UrlIngestionOptions extends IngestionOptions {
  /** An explicit opt-out prevents the fetcher from being invoked. */
  readonly approved?: boolean;
  /** An optional approval gate for callers that need an asynchronous decision. */
  readonly approval?: boolean | (() => boolean | Promise<boolean>);
  readonly fetcher?: UrlFetcher;
  /** Override DNS resolution in tests or a host-owned network policy. */
  readonly resolveHostname?: UrlHostnameResolver;
  readonly maxRedirects?: number;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly maxExtractedCharacters?: number;
  readonly now?: () => Date;
}

export interface UrlAdapterInput {
  readonly url: UrlProvenance;
  readonly mediaType: Extract<SupportedMediaType, "text/plain" | "text/markdown" | "text/html">;
  /** Fetched response content. Adapters never fetch or resolve this content. */
  readonly content: string;
  /** The text already produced by the bounded generic extractor, when available. */
  readonly normalizedText?: string;
}

const maxBinaryBytes = 32 * 1024 * 1024;
const maxExtractedCharacters = 2_000_000;
const maxUrlRedirects = 5;
const maxUrlTimeoutMs = 30_000;
const maxUrlResponseBytes = 4 * 1024 * 1024;

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

export function classifyUrl(input: string | URL): UrlSourceKind {
  let parsed: URL;
  try {
    parsed = typeof input === "string" ? new URL(input) : input;
  } catch {
    return "generic";
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/u, "");
  const pathname = parsed.pathname.toLowerCase();

  if (
    hostname === "github.com" ||
    hostname.endsWith(".github.com") ||
    hostname === "githubusercontent.com" ||
    hostname.endsWith(".githubusercontent.com")
  ) {
    return "github";
  }

  if (
    hostname === "credly.com" ||
    hostname.endsWith(".credly.com") ||
    hostname === "badgr.com" ||
    hostname.endsWith(".badgr.com") ||
    hostname === "accredible.com" ||
    hostname.endsWith(".accredible.com") ||
    /\/(?:certificates?|certifications?|credentials?|badges?)(?:\/|$)/u.test(pathname)
  ) {
    return "certification";
  }

  if (
    hostname.startsWith("jobs.") ||
    hostname.startsWith("careers.") ||
    hostname === "greenhouse.io" ||
    hostname.endsWith(".greenhouse.io") ||
    hostname === "lever.co" ||
    hostname.endsWith(".lever.co") ||
    hostname === "ashbyhq.com" ||
    hostname.endsWith(".ashbyhq.com") ||
    hostname === "workable.com" ||
    hostname.endsWith(".workable.com") ||
    hostname === "smartrecruiters.com" ||
    hostname.endsWith(".smartrecruiters.com") ||
    hostname === "jobvite.com" ||
    hostname.endsWith(".jobvite.com") ||
    hostname === "icims.com" ||
    hostname.endsWith(".icims.com") ||
    hostname === "bamboohr.com" ||
    hostname.endsWith(".bamboohr.com") ||
    hostname === "recruitee.com" ||
    hostname.endsWith(".recruitee.com") ||
    hostname === "teamtailor.com" ||
    hostname.endsWith(".teamtailor.com") ||
    hostname === "personio.com" ||
    hostname.endsWith(".personio.com") ||
    hostname === "myworkdayjobs.com" ||
    hostname.endsWith(".myworkdayjobs.com") ||
    hostname === "successfactors.com" ||
    hostname.endsWith(".successfactors.com") ||
    hostname === "oraclecloud.com" ||
    hostname.endsWith(".oraclecloud.com") ||
    /\/(?:job|jobs|career|careers|position|positions|vacancy|vacancies|opening|openings|job-description)(?:\/|$)/u.test(
      pathname,
    )
  ) {
    return "job-description";
  }

  if (
    hostname === "linkedin.com" ||
    hostname.endsWith(".linkedin.com") ||
    hostname.startsWith("profile.") ||
    /\/(?:in|pub|profile|bio)(?:\/|$)/u.test(pathname)
  ) {
    return "profile";
  }

  if (
    hostname.startsWith("portfolio.") ||
    /\/(?:portfolio|projects?|work|showcase)(?:\/|$)/u.test(pathname)
  ) {
    return "portfolio";
  }

  return "generic";
}

function isSupportedMediaType(value: string): value is SupportedMediaType {
  return (supportedMediaTypes as readonly string[]).includes(value);
}

function isUrlTextMediaType(value: SupportedMediaType): value is UrlAdapterInput["mediaType"] {
  return value === "text/plain" || value === "text/markdown" || value === "text/html";
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

const technologyNames = [
  "TypeScript",
  "JavaScript",
  "Python",
  "Ruby",
  "Java",
  "Kotlin",
  "Swift",
  "Go",
  "Rust",
  "C#",
  "C++",
  ".NET",
  "React",
  "Vue.js",
  "Angular",
  "Svelte",
  "Next.js",
  "Node.js",
  "Express",
  "Django",
  "FastAPI",
  "Spring",
  "Rails",
  "PostgreSQL",
  "MySQL",
  "SQLite",
  "MongoDB",
  "Redis",
  "GraphQL",
  "REST",
  "Docker",
  "Kubernetes",
  "Terraform",
  "AWS",
  "Azure",
  "GCP",
  "GitHub Actions",
  "Jest",
  "Vitest",
  "Playwright",
] as const;

type UrlFactCandidate = Omit<UrlSourceFact, "locator" | "sourceUrl" | "status"> & {
  readonly locatorText: string;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function cleanFactValue(value: string): string {
  return value
    .replace(/^#{1,6}\s*/u, "")
    .replace(/[`*_]/gu, "")
    .replace(/^[-*+•]\s*/u, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function lineLocator(text: string, value: string): SourceLocator {
  const needle = value.trim().toLocaleLowerCase();
  if (needle !== "") {
    const lines = text.split("\n");
    const lineIndex = lines.findIndex((line) => line.toLocaleLowerCase().includes(needle));
    if (lineIndex >= 0) return { lineStart: lineIndex + 1, lineEnd: lineIndex + 1 };
  }
  return { lineStart: 1, lineEnd: 1 };
}

function urlFactSection(value: string): UrlFactKind | undefined {
  const normalized = cleanFactValue(value).toLocaleLowerCase().replace(/[:.]$/u, "");
  if (/^(?:featured )?projects?$/u.test(normalized)) return "project";
  if (
    /^(?:technical )?(?:skills?|technologies|tech stack|tools|stack|requirements?|qualifications?)$/u.test(
      normalized,
    )
  ) {
    return "technology";
  }
  if (/^(?:work )?(?:experience|employment|roles?)$/u.test(normalized)) return "role";
  if (/^(?:certifications?|credentials?|degrees?|education)$/u.test(normalized)) {
    return "credential";
  }
  if (/^(?:dates?|timeline|period|duration|posted|published|issued|expires?)$/u.test(normalized)) {
    return "date";
  }
  return undefined;
}

function urlFactLabelKind(value: string): UrlFactKind | undefined {
  const normalized = value.toLocaleLowerCase().replace(/\s+/gu, " ").trim();
  if (/^(?:project|project name|featured project)s?$/u.test(normalized)) return "project";
  if (
    /^(?:technology|technologies|tech stack|skills?|tools|stack|requirements?|qualifications?)$/u.test(
      normalized,
    )
  ) {
    return "technology";
  }
  if (/^(?:role|title|position|job title)$/u.test(normalized)) return "role";
  if (/^(?:date|dates|period|duration|posted|published|issued|expires?)$/u.test(normalized)) {
    return "date";
  }
  if (
    /^(?:credential|credentials|credential id|certification|certifications|degree|education)$/u.test(
      normalized,
    )
  ) {
    return "credential";
  }
  return undefined;
}

function markdownHeadings(content: string): readonly string[] {
  return [...content.matchAll(/^\s*#{1,6}\s+(.+?)\s*#*\s*$/gmu)].map((match) =>
    cleanFactValue(match[1] ?? ""),
  );
}

function htmlHeadings(content: string): readonly string[] {
  return [...content.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]\s*>/giu)].map((match) =>
    cleanFactValue(extractHtml(match[1] ?? "")),
  );
}

function headingValues(
  content: string,
  mediaType: UrlAdapterInput["mediaType"],
): readonly string[] {
  if (mediaType === "text/html") return htmlHeadings(content);
  if (mediaType === "text/markdown") return markdownHeadings(content);
  return [];
}

function splitFactValues(value: string): readonly string[] {
  return value
    .split(/\s*(?:,|;|\||·)\s*/u)
    .flatMap((part) => part.split(/\s+and\s+/iu))
    .map(cleanFactValue)
    .filter((part) => part.length > 0 && part.length <= 120);
}

function dateValues(value: string): readonly string[] {
  const datePattern =
    /\b(?:(?:19|20)\d{2}(?:\s*(?:[-–—]|to)\s*(?:(?:19|20)\d{2}|present))?|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(?:19|20)\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b/giu;
  return [...value.matchAll(datePattern)].map((match) => match[0]);
}

function roleLikeHeading(value: string): boolean {
  return /\b(?:engineer|developer|designer|manager|scientist|analyst|architect|director|lead|intern|consultant|specialist|officer|chief|head)\b/iu.test(
    value,
  );
}

function safeEmbeddedUrl(value: string, baseUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(value, baseUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "") {
    return null;
  }
  parsed.hash = "";
  return parseSafeUrl(parsed.href)?.href ?? null;
}

function linkCandidates(
  content: string,
  mediaType: UrlAdapterInput["mediaType"],
  baseUrl: string,
): readonly UrlFactCandidate[] {
  const candidates: UrlFactCandidate[] = [];
  if (mediaType === "text/html") {
    const pattern =
      /<a\b[^>]*\bhref\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a\s*>/giu;
    for (const match of content.matchAll(pattern)) {
      const href = safeEmbeddedUrl(match[1] ?? match[2] ?? match[3] ?? "", baseUrl);
      if (href === null) continue;
      const label = cleanFactValue(extractHtml(match[4] ?? ""));
      candidates.push({
        kind: "link",
        value: href,
        locatorText: label === "" ? href : label,
        confidence: 0.95,
        ...(label === "" ? {} : { label }),
      });
    }
  } else {
    const pattern = /\[([^\]]+)\]\(\s*(https:\/\/[^\s)]+)(?:\s+["'][^)]*["'])?\s*\)/giu;
    for (const match of content.matchAll(pattern)) {
      const href = safeEmbeddedUrl(match[2] ?? "", baseUrl);
      if (href === null) continue;
      const label = cleanFactValue(match[1] ?? "");
      candidates.push({
        kind: "link",
        value: href,
        locatorText: label === "" ? href : label,
        confidence: 0.95,
        ...(label === "" ? {} : { label }),
      });
    }
  }
  return candidates;
}

function extractUrlFactCandidates(
  input: UrlAdapterInput,
  normalizedText: string,
): readonly UrlFactCandidate[] {
  if (
    !["github", "job-description", "certification", "profile", "portfolio"].includes(input.url.kind)
  ) {
    return [];
  }
  if (normalizedText.trim() === "") return [];

  const candidates: UrlFactCandidate[] = [];
  const add = (
    kind: UrlFactKind,
    value: string,
    confidence: number,
    locatorText = value,
    label?: string,
  ): void => {
    const cleaned = cleanFactValue(value);
    if (cleaned === "") return;
    candidates.push({
      kind,
      value: cleaned,
      locatorText: cleanFactValue(locatorText),
      confidence,
      ...(label === undefined ? {} : { label }),
    });
  };

  const headings = new Set(headingValues(input.content, input.mediaType));
  const htmlListItems = new Set(
    [...input.content.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li\s*>/giu)].map((match) =>
      cleanFactValue(extractHtml(match[1] ?? "")),
    ),
  );
  const ignoredGithubHeadings =
    /^(?:installation|usage|setup|contributing|license|contact|about|getting started)$/iu;
  let section: UrlFactKind | undefined;
  for (const line of normalizedText.split("\n")) {
    const cleanLine = cleanFactValue(line);
    if (cleanLine === "") continue;
    const heading = headings.has(cleanLine) || /^#{1,6}\s+/u.test(line.trim());
    if (heading) {
      section = urlFactSection(cleanLine);
      if (section === undefined) {
        if (
          (input.url.kind === "github" || input.url.kind === "portfolio") &&
          !ignoredGithubHeadings.test(cleanLine)
        ) {
          add("project", cleanLine, 0.85);
        } else if (input.url.kind === "certification") {
          add("credential", cleanLine, 0.85);
        } else if (
          (input.url.kind === "job-description" || input.url.kind === "profile") &&
          roleLikeHeading(cleanLine)
        ) {
          add("role", cleanLine, 0.85);
        }
      }
      continue;
    }

    const labelMatch = cleanLine.match(/^([A-Za-z][A-Za-z ]{1,32})\s*:\s*(.+)$/u);
    if (labelMatch !== null) {
      const labeledKind = urlFactLabelKind(labelMatch[1] ?? "");
      const labeledValue = labelMatch[2] ?? "";
      if (labeledKind === "date") {
        for (const value of dateValues(labeledValue)) add("date", value, 0.95, value);
      } else if (labeledKind === "technology") {
        for (const value of splitFactValues(labeledValue)) add("technology", value, 0.95);
      } else if (labeledKind !== undefined) {
        add(labeledKind, labeledValue, 0.95);
      }
      continue;
    }

    if (section === "technology") {
      for (const value of splitFactValues(cleanLine)) add("technology", value, 0.82);
    } else if (
      section === "project" &&
      (line.trim().startsWith("-") || line.trim().startsWith("*") || htmlListItems.has(cleanLine))
    ) {
      add("project", cleanLine, 0.82);
    } else if (
      section === "role" &&
      (line.trim().startsWith("-") || line.trim().startsWith("*") || htmlListItems.has(cleanLine))
    ) {
      add("role", cleanLine, 0.82);
    } else if (
      section === "credential" &&
      (line.trim().startsWith("-") || line.trim().startsWith("*") || htmlListItems.has(cleanLine))
    ) {
      add("credential", cleanLine, 0.82);
    }
  }

  for (const candidate of linkCandidates(input.content, input.mediaType, input.url.finalUrl)) {
    candidates.push(candidate);
  }
  for (const match of normalizedText.matchAll(/https:\/\/[^\s<>)"']+/giu)) {
    const href = safeEmbeddedUrl(match[0], input.url.finalUrl);
    if (href !== null) add("link", href, 0.9, match[0]);
  }

  for (const match of normalizedText.matchAll(
    /\b(?:19|20)\d{2}(?:\s*(?:[-–—]|to)\s*(?:(?:19|20)\d{2}|present))?\b/giu,
  )) {
    add("date", match[0], 0.8, match[0]);
  }

  for (const technology of technologyNames) {
    const pattern = new RegExp(
      `(?:^|[^\\p{L}\\p{N}])${escapeRegExp(technology)}(?=$|[^\\p{L}\\p{N}])`,
      "iu",
    );
    if (pattern.test(normalizedText)) add("technology", technology, 0.76, technology);
  }
  return candidates;
}

export function extractUrlFacts(input: UrlAdapterInput): UrlExtraction {
  const normalizedText =
    input.normalizedText ??
    (input.mediaType === "text/html" ? extractHtml(input.content) : normalizeText(input.content));
  const candidates = extractUrlFactCandidates(input, normalizedText);
  const facts: UrlSourceFact[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const key = `${candidate.kind}\u0000${candidate.value.toLocaleLowerCase()}\u0000${input.url.finalUrl}`;
    if (seen.has(key)) continue;
    seen.add(key);
    facts.push({
      kind: candidate.kind,
      value: candidate.value,
      sourceUrl: input.url.finalUrl,
      locator: lineLocator(normalizedText, candidate.locatorText),
      status: "extracted",
      confidence: candidate.confidence,
      ...(candidate.label === undefined ? {} : { label: candidate.label }),
    });
  }
  if (facts.length === 0) {
    return { status: "generic-fallback", confidence: 0.25, facts: [] };
  }
  return {
    status: "extracted",
    confidence: Math.max(...facts.map((fact) => fact.confidence)),
    facts,
  };
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

function parsePdfCMap(cmapText: string): Map<number, string> {
  const map = new Map<number, string>();
  const bfCharRegex = /beginbfchar([\s\S]*?)endbfchar/gu;
  for (const match of cmapText.matchAll(bfCharRegex)) {
    const lines = match[1]?.trim().split(/\r?\n/) ?? [];
    for (const line of lines) {
      const parts = line.trim().match(/<([0-9a-fA-F]+)>\s+<([0-9a-fA-F]+)>/u);
      if (parts?.[1] && parts[2]) {
        const src = Number.parseInt(parts[1], 16);
        const dstHex = parts[2];
        let dstStr = "";
        for (let i = 0; i < dstHex.length; i += 4) {
          const code = Number.parseInt(dstHex.slice(i, i + 4), 16);
          if (!Number.isNaN(code) && code > 0) {
            dstStr += String.fromCharCode(code);
          }
        }
        map.set(src, dstStr);
      }
    }
  }
  const bfRangeRegex = /beginbfrange([\s\S]*?)endbfrange/gu;
  for (const match of cmapText.matchAll(bfRangeRegex)) {
    const lines = match[1]?.trim().split(/\r?\n/) ?? [];
    for (const line of lines) {
      const rangeMatch = line
        .trim()
        .match(/<([0-9a-fA-F]+)>\s+<([0-9a-fA-F]+)>\s+<([0-9a-fA-F]+)>/u);
      if (rangeMatch?.[1] && rangeMatch[2] && rangeMatch[3]) {
        const startSrc = Number.parseInt(rangeMatch[1], 16);
        const endSrc = Number.parseInt(rangeMatch[2], 16);
        const startDst = Number.parseInt(rangeMatch[3], 16);
        if (!Number.isNaN(startSrc) && !Number.isNaN(endSrc) && !Number.isNaN(startDst)) {
          for (let src = startSrc; src <= endSrc; src++) {
            map.set(src, String.fromCharCode(startDst + (src - startSrc)));
          }
        }
      }
    }
  }
  return map;
}

function decodePdfHex(hex: string, cmaps: Map<number, string>): string {
  let result = "";
  if (hex.length >= 4 && hex.length % 4 === 0) {
    for (let i = 0; i < hex.length; i += 4) {
      const chunk = hex.slice(i, i + 4);
      const code = Number.parseInt(chunk, 16);
      if (cmaps.has(code)) {
        result += cmaps.get(code) ?? "";
      } else if (!Number.isNaN(code) && code > 0) {
        result += String.fromCharCode(code);
      }
    }
    return result;
  }
  for (let i = 0; i < hex.length; i += 2) {
    const chunk = hex.slice(i, i + 2);
    const code = Number.parseInt(chunk, 16);
    if (cmaps.has(code)) {
      result += cmaps.get(code) ?? "";
    } else if (!Number.isNaN(code) && code > 0) {
      result += String.fromCharCode(code);
    }
  }
  return result;
}

function extractPdfOperators(content: string, cmaps: Map<number, string>): string {
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
    if (character === "<" && !content.startsWith("<<", index)) {
      const closing = content.indexOf(">", index);
      if (closing !== -1) {
        const hex = content.slice(index + 1, closing).replace(/\s+/gu, "");
        if (/^[0-9a-fA-F]+$/u.test(hex)) {
          let cursor = closing + 1;
          while (/\s/u.test(content[cursor] ?? "")) cursor += 1;
          if (content.startsWith("Tj", cursor)) {
            result += `${decodePdfHex(hex, cmaps)}\n`;
            index = cursor + 2;
            continue;
          }
        }
        index = closing + 1;
        continue;
      }
    }
    if (character === "[") {
      const closing = content.indexOf("]", index);
      if (closing !== -1) {
        let cursor = closing + 1;
        while (/\s/u.test(content[cursor] ?? "")) cursor += 1;
        if (content.startsWith("TJ", cursor)) {
          const inner = content.slice(index + 1, closing);
          let textChunk = "";
          for (const hexPart of inner.matchAll(/<([0-9a-fA-F]+)>/gu)) {
            if (hexPart[1]) {
              textChunk += decodePdfHex(hexPart[1], cmaps);
            }
          }
          if (textChunk === "") {
            for (const litPart of inner.matchAll(/\(([^)]*)\)/gu)) {
              if (litPart[1]) {
                textChunk += decodePdfLiteral(litPart[1]);
              }
            }
          }
          if (textChunk !== "") {
            result += `${textChunk}\n`;
          }
          index = cursor + 2;
          continue;
        }
      }
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

  const streams = /stream(?:\r\n|\n|\r)([\s\S]*?)(?:\r\n|\n|\r)endstream/gu;
  const cmaps = new Map<number, string>();
  const decodedStreams: string[] = [];

  for (const match of binary.matchAll(streams)) {
    const stream = match[1] ?? "";
    const streamOffset = match.index ?? 0;
    const dictionary = binary.slice(Math.max(0, streamOffset - 1200), streamOffset);
    let decoded = latin1Bytes(stream);
    if (/\/FlateDecode\b/u.test(dictionary)) {
      try {
        decoded = new Uint8Array(inflateSync(decoded));
      } catch {
        continue;
      }
    }
    const streamText = Buffer.from(decoded).toString("latin1");
    decodedStreams.push(streamText);
    if (streamText.includes("begincmap")) {
      const parsed = parsePdfCMap(streamText);
      for (const [k, v] of parsed.entries()) {
        cmaps.set(k, v);
      }
    }
  }

  const textParts: string[] = [];
  for (const streamText of decodedStreams) {
    const extracted = extractPdfOperators(streamText, cmaps);
    if (extracted !== "") {
      textParts.push(extracted);
    }
  }

  const text = normalizeText(textParts.join("\n"));
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
  url: UrlProvenance | undefined = undefined,
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
      ...(url === undefined ? {} : { url }),
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

function sourceWithUrl(source: IngestionSource, url: UrlProvenance | undefined): IngestionSource {
  return url === undefined ? source : { ...source, url };
}

async function normalizeIngestedBytes(
  source: IngestionSource,
  mediaType: SupportedMediaType,
  bytes: Uint8Array,
  options: IngestionOptions,
  url: UrlProvenance | undefined = undefined,
  maxTextCharacters: number | undefined = undefined,
): Promise<IngestionResult> {
  const sourceChecksum = checksum(bytes);
  const extracted = await extractSource(source, mediaType, bytes, sourceChecksum, options);
  const issues = [...extracted.issues];
  let text = extracted.text;
  if (maxTextCharacters !== undefined && text.length > maxTextCharacters) {
    text = "";
    issues.push(
      issue(
        "extracted-content-too-large",
        source.path,
        "The source contains more extracted text than the configured limit.",
      ),
    );
  }
  if (text.length === 0 && extracted.issues.length === 0 && issues.length === 0) {
    issues.push(
      issue("empty-content", source.path, "The source file contains no extractable text."),
    );
  }

  const maxChunkCharacters = options.maxChunkCharacters ?? 1200;
  if (!Number.isInteger(maxChunkCharacters) || maxChunkCharacters < 1) {
    throw new RangeError("maxChunkCharacters must be a positive integer.");
  }

  const normalizedSource = sourceWithUrl(source, url);
  const provenance = url ?? source.url;
  const urlExtraction =
    provenance === undefined || !isUrlTextMediaType(mediaType)
      ? undefined
      : extractUrlFacts({
          url: provenance,
          mediaType,
          content: new TextDecoder().decode(bytes),
          normalizedText: text,
        });
  return {
    source: {
      source: normalizedSource,
      mediaType,
      checksum: sourceChecksum,
      text,
      chunks: createChunks(
        text,
        source.path,
        mediaType,
        sourceChecksum,
        maxChunkCharacters,
        provenance,
      ),
      issues,
      ...(provenance === undefined ? {} : { url: provenance }),
      ...(urlExtraction === undefined ? {} : { urlExtraction }),
    },
    issues,
  };
}

function urlIssue(
  code:
    | "approval-required"
    | "unsafe-url"
    | "redirect-limit"
    | "fetch-timeout"
    | "response-too-large"
    | "fetch-failure"
    | "unsupported-content-type"
    | "extracted-content-too-large",
  sourcePath: string,
): IngestionIssue {
  const messages: Readonly<Record<typeof code, string>> = {
    "approval-required": "URL ingestion requires explicit approval before fetching.",
    "unsafe-url": "The URL is not allowed for safe ingestion.",
    "redirect-limit": "The URL redirect limit was exceeded.",
    "fetch-timeout": "The URL request exceeded the configured timeout.",
    "response-too-large": "The URL response exceeds the configured size limit.",
    "fetch-failure": "The URL could not be fetched.",
    "unsupported-content-type": "The URL response content type is not supported.",
    "extracted-content-too-large":
      "The URL response contains more extracted text than the configured limit.",
  };
  return issue(code, sourcePath, messages[code]);
}

function ipv4Parts(hostname: string): readonly number[] | null {
  const parts = hostname.split(".");
  if (parts.length !== 4) return null;
  const values = parts.map((part) => Number.parseInt(part, 10));
  if (
    values.some(
      (value, index) =>
        !Number.isInteger(value) || value < 0 || value > 255 || parts[index]?.length === 0,
    )
  ) {
    return null;
  }
  return values;
}

function unsafeIpv4(parts: readonly number[]): boolean {
  const [first = 0, second = 0, third = 0] = parts;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && third === 0) ||
    (first === 192 && second === 168) ||
    (first === 198 && second >= 18 && second <= 19) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
    first >= 224
  );
}

function ipv6Parts(hostname: string): readonly number[] | null {
  const value = hostname.replace(/^\[|\]$/gu, "").toLowerCase();
  const halves = value.split("::");
  if (halves.length > 2) return null;

  const parseHalf = (half: string): number[] | null => {
    if (half === "") return [];
    const parts = half.split(":");
    const result: number[] = [];
    for (const part of parts) {
      if (part.includes(".")) {
        const ipv4 = ipv4Parts(part);
        if (ipv4 === null || result.length + 2 > 8) return null;
        result.push((ipv4[0] ?? 0) * 256 + (ipv4[1] ?? 0));
        result.push((ipv4[2] ?? 0) * 256 + (ipv4[3] ?? 0));
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/u.test(part)) return null;
      result.push(Number.parseInt(part, 16));
    }
    return result;
  };

  const left = parseHalf(halves[0] ?? "");
  const right = halves.length === 2 ? parseHalf(halves[1] ?? "") : [];
  if (left === null || right === null) return null;
  const missing = halves.length === 2 ? 8 - left.length - right.length : 0;
  if (missing < (halves.length === 2 ? 1 : 0) || left.length + right.length + missing !== 8) {
    return null;
  }
  return [...left, ...new Array<number>(missing).fill(0), ...right];
}

function unsafeLiteralHostname(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/gu, "").toLowerCase();
  if (normalized === "localhost" || normalized.endsWith(".localhost")) return true;

  const kind = isIP(normalized);
  if (kind === 4) {
    const parts = ipv4Parts(normalized);
    return parts === null || unsafeIpv4(parts);
  }
  if (kind !== 6) return false;

  const parts = ipv6Parts(normalized);
  if (parts === null) return true;
  const first = parts[0] ?? 0;
  const mapped = parts.slice(0, 6).every((part) => part === 0) && parts[5] === 0xffff;
  if (mapped) {
    const mappedIpv4 = [
      (parts[6] ?? 0) >>> 8,
      (parts[6] ?? 0) & 0xff,
      (parts[7] ?? 0) >>> 8,
      (parts[7] ?? 0) & 0xff,
    ];
    return unsafeIpv4(mappedIpv4);
  }
  return (
    parts.every((part) => part === 0) ||
    (parts.slice(0, 7).every((part) => part === 0) && parts[7] === 1) ||
    (first & 0xfe00) === 0xfc00 ||
    (first & 0xffc0) === 0xfe80 ||
    (first & 0xff00) === 0xff00
  );
}

function parseSafeUrl(input: string): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return null;
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.hash !== "" ||
    parsed.hostname === "" ||
    unsafeLiteralHostname(parsed.hostname)
  ) {
    return null;
  }
  return parsed;
}

function boundedUrlLimit(
  value: number | undefined,
  fallback: number,
  maximum: number,
  allowZero = false,
): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || (allowZero ? value < 0 : value < 1)) {
    throw new RangeError("URL ingestion limits must be positive integers.");
  }
  return Math.min(value, maximum);
}

class UrlTimeoutError extends Error {}
class UrlResponseTooLargeError extends Error {}

async function withUrlTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  controller: AbortController,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new UrlTimeoutError());
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation(), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function readResponseBytes(
  response: Response,
  maximum: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null && /^\d+$/u.test(contentLength.trim())) {
    const declared = Number(contentLength.trim());
    if (Number.isSafeInteger(declared) && declared > maximum) {
      void response.body?.cancel().catch(() => undefined);
      throw new UrlResponseTooLargeError();
    }
  }

  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const cancelOnAbort = (): void => {
    void reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener("abort", cancelOnAbort, { once: true });
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      const chunk = next.value;
      if (chunk === undefined || total + chunk.byteLength > maximum) {
        throw new UrlResponseTooLargeError();
      }
      chunks.push(chunk);
      total += chunk.byteLength;
    }
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    signal?.removeEventListener("abort", cancelOnAbort);
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function responseMediaType(response: Response, url: URL): SupportedMediaType | null {
  const header = response.headers.get("content-type");
  if (header === null || header.trim() === "") {
    return detectMediaType({ path: url.pathname });
  }
  const mediaType = header.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType === "application/xhtml+xml") return "text/html";
  if (mediaType === "text/x-markdown") return "text/markdown";
  return mediaType !== undefined && isSupportedMediaType(mediaType) ? mediaType : null;
}

async function approvalAllowsUrlIngestion(options: UrlIngestionOptions): Promise<boolean> {
  if (options.approved === false || options.approval === false) return false;
  if (typeof options.approval === "function") {
    try {
      return await options.approval();
    } catch {
      return false;
    }
  }
  return true;
}

const defaultUrlFetcher: UrlFetcher = (input, init) => globalThis.fetch(input, init);
const defaultUrlHostnameResolver: UrlHostnameResolver = async (hostname) =>
  (await lookup(hostname, { all: true })).map((address) => address.address);

async function resolvedUrlIsSafe(
  parsed: URL,
  options: UrlIngestionOptions,
  fetcher: UrlFetcher,
): Promise<boolean> {
  if (unsafeLiteralHostname(parsed.hostname)) return false;
  if (options.resolveHostname === undefined && fetcher !== defaultUrlFetcher) return true;
  const resolver = options.resolveHostname ?? defaultUrlHostnameResolver;
  try {
    const addresses = await resolver(parsed.hostname);
    return addresses.length > 0 && addresses.every((address) => !unsafeLiteralHostname(address));
  } catch {
    return false;
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

  return normalizeIngestedBytes(source, mediaType, bytes, options, source.url);
}

export async function ingestUrl(
  input: string,
  options: UrlIngestionOptions = {},
): Promise<IngestionResult> {
  const parsed = parseSafeUrl(input);
  if (parsed === null) {
    return { source: null, issues: [urlIssue("unsafe-url", input)] };
  }

  const originalUrl = parsed.href;
  if (!(await approvalAllowsUrlIngestion(options))) {
    return { source: null, issues: [urlIssue("approval-required", originalUrl)] };
  }

  const maxRedirects = boundedUrlLimit(
    options.maxRedirects,
    maxUrlRedirects,
    maxUrlRedirects,
    true,
  );
  const timeoutMs = boundedUrlLimit(options.timeoutMs, 10_000, maxUrlTimeoutMs);
  const maxResponseBytes = boundedUrlLimit(
    options.maxResponseBytes,
    maxUrlResponseBytes,
    maxUrlResponseBytes,
  );
  const maxTextCharacters = boundedUrlLimit(
    options.maxExtractedCharacters,
    maxExtractedCharacters,
    maxExtractedCharacters,
  );
  const fetcher = options.fetcher ?? defaultUrlFetcher;
  if (!(await resolvedUrlIsSafe(parsed, options, fetcher))) {
    return { source: null, issues: [urlIssue("unsafe-url", originalUrl)] };
  }
  let currentUrl = parsed;
  let redirects = 0;

  while (true) {
    let response: Response;
    try {
      const controller = new AbortController();
      response = await withUrlTimeout(
        () => fetcher(currentUrl.href, { redirect: "manual", signal: controller.signal }),
        timeoutMs,
        controller,
      );
    } catch (error) {
      return {
        source: null,
        issues: [
          urlIssue(
            error instanceof UrlTimeoutError ? "fetch-timeout" : "fetch-failure",
            originalUrl,
          ),
        ],
      };
    }

    const observedUrl = typeof response.url === "string" ? response.url.trim() : "";
    if (observedUrl !== "") {
      const safeObservedUrl = parseSafeUrl(observedUrl);
      if (safeObservedUrl === null) {
        return { source: null, issues: [urlIssue("unsafe-url", originalUrl)] };
      }
      if (!(await resolvedUrlIsSafe(safeObservedUrl, options, fetcher))) {
        return { source: null, issues: [urlIssue("unsafe-url", originalUrl)] };
      }
      currentUrl = safeObservedUrl;
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirects >= maxRedirects) {
        return { source: null, issues: [urlIssue("redirect-limit", originalUrl)] };
      }
      const location = response.headers.get("location");
      if (location === null) {
        return { source: null, issues: [urlIssue("fetch-failure", originalUrl)] };
      }
      let redirectUrl: URL;
      try {
        redirectUrl = new URL(location, currentUrl);
      } catch {
        return { source: null, issues: [urlIssue("unsafe-url", originalUrl)] };
      }
      const safeRedirectUrl = parseSafeUrl(redirectUrl.href);
      if (safeRedirectUrl === null) {
        return { source: null, issues: [urlIssue("unsafe-url", originalUrl)] };
      }
      if (!(await resolvedUrlIsSafe(safeRedirectUrl, options, fetcher))) {
        return { source: null, issues: [urlIssue("unsafe-url", originalUrl)] };
      }
      currentUrl = safeRedirectUrl;
      redirects += 1;
      continue;
    }

    if (response.status < 200 || response.status >= 300) {
      return { source: null, issues: [urlIssue("fetch-failure", originalUrl)] };
    }

    const mediaType = responseMediaType(response, currentUrl);
    if (
      mediaType === null ||
      mediaType === "application/pdf" ||
      mediaType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      return { source: null, issues: [urlIssue("unsupported-content-type", originalUrl)] };
    }

    let bytes: Uint8Array;
    try {
      const controller = new AbortController();
      bytes = await withUrlTimeout(
        () => readResponseBytes(response, maxResponseBytes, controller.signal),
        timeoutMs,
        controller,
      );
    } catch (error) {
      return {
        source: null,
        issues: [
          urlIssue(
            error instanceof UrlTimeoutError
              ? "fetch-timeout"
              : error instanceof UrlResponseTooLargeError
                ? "response-too-large"
                : "fetch-failure",
            originalUrl,
          ),
        ],
      };
    }

    const provenance: UrlProvenance = {
      originalUrl,
      finalUrl: currentUrl.href,
      fetchedAt: (options.now?.() ?? new Date()).toISOString(),
      kind: classifyUrl(originalUrl),
    };
    const source: IngestionSource = {
      path: originalUrl,
      mediaType,
      url: provenance,
    };
    return normalizeIngestedBytes(source, mediaType, bytes, options, provenance, maxTextCharacters);
  }
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

export interface PortfolioProject {
  readonly name: string;
  readonly description: string;
  readonly url?: string;
  readonly role?: string;
  readonly dateRange?: string;
  readonly technologies: readonly string[];
  readonly highlights: readonly string[];
}

export interface PortfolioManifest {
  readonly authorName?: string;
  readonly headline?: string;
  readonly summary?: string;
  readonly projects: readonly PortfolioProject[];
}

export function ingestPortfolioManifest(
  manifest: PortfolioManifest,
  sourcePath = "/sources/portfolio.json",
): readonly SourceChunk[] {
  const chunks: SourceChunk[] = [];
  let currentLine = 1;

  if (manifest.summary && manifest.summary.trim() !== "") {
    const text = manifest.headline ? `${manifest.headline}: ${manifest.summary}` : manifest.summary;
    const lineCount = text.split("\n").length;
    chunks.push({
      id: `${sourcePath}#L${currentLine}-L${currentLine + lineCount - 1}`,
      sourcePath,
      mediaType: "text/plain",
      checksum: createHash("sha256").update(text, "utf8").digest("hex"),
      locator: {
        lineStart: currentLine,
        lineEnd: currentLine + lineCount - 1,
      },
      text,
    });
    currentLine += lineCount + 1;
  }

  for (const project of manifest.projects) {
    const techLine =
      project.technologies.length > 0 ? `Technologies: ${project.technologies.join(", ")}` : "";
    const highlightsText =
      project.highlights.length > 0 ? project.highlights.map((h) => `- ${h}`).join("\n") : "";
    const parts = [
      `Project: ${project.name}`,
      project.role ? `Role: ${project.role}` : "",
      project.dateRange ? `Period: ${project.dateRange}` : "",
      project.description,
      techLine,
      highlightsText,
    ].filter((p) => p.trim() !== "");

    const chunkText = parts.join("\n");
    const lineCount = chunkText.split("\n").length;

    chunks.push({
      id: `${sourcePath}#L${currentLine}-L${currentLine + lineCount - 1}`,
      sourcePath,
      mediaType: "text/plain",
      checksum: createHash("sha256").update(chunkText, "utf8").digest("hex"),
      locator: {
        lineStart: currentLine,
        lineEnd: currentLine + lineCount - 1,
      },
      text: chunkText,
    });
    currentLine += lineCount + 1;
  }

  return chunks;
}
