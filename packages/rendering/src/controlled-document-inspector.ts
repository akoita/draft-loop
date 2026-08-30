import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";

import {
  type RenderingQaViewerObservation,
  renderingQaViewerObservationSchema,
} from "@draft-loop/schemas";

import type { RenderedDocument } from "./index.js";

interface VisibleTextUnit {
  readonly text: string;
  readonly kind: "heading" | "body";
}

interface InspectedPage {
  readonly units: readonly VisibleTextUnit[];
  readonly clipped: boolean;
}

interface ZipEntry {
  readonly name: string;
  readonly content: Uint8Array;
}

/** A malformed or unsupported controlled document cannot produce QA evidence. */
export class ControlledDocumentInspectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ControlledDocumentInspectionError";
  }
}

function fail(message: string): never {
  throw new ControlledDocumentInspectionError(message);
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function checksum(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

function normalizeText(text: string): string {
  return text
    .replace(/^\s*[-*•]\s+/u, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function contentSequence(units: readonly VisibleTextUnit[]): string {
  return units
    .map((unit) => normalizeText(unit.text))
    .filter((text) => text !== "")
    .join(" ");
}

function wordCount(text: string): number {
  const normalized = normalizeText(text);
  return normalized === "" ? 0 : normalized.split(/\s+/u).length;
}

function decodeUtf8(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail(`${label} is not valid UTF-8`);
  }
}

function littleEndian(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function hasPrefix(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((byte, index) => bytes[index] === byte);
}

function readZipEntries(content: Uint8Array): readonly ZipEntry[] {
  if (!hasPrefix(content, [0x50, 0x4b, 0x03, 0x04])) {
    fail("controlled DOCX content must start with a ZIP local-file signature");
  }
  const view = new DataView(content.buffer, content.byteOffset, content.byteLength);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const entries: ZipEntry[] = [];
  const names = new Set<string>();
  let offset = 0;
  let reachedCentralDirectory = false;
  let reachedEnd = false;
  while (offset + 4 <= content.byteLength) {
    const signature = view.getUint32(offset, true);
    if (signature === 0x02014b50) {
      reachedCentralDirectory = true;
      break;
    }
    if (signature === 0x06054b50) {
      reachedEnd = true;
      break;
    }
    if (signature !== 0x04034b50 || offset + 30 > content.byteLength) {
      fail("controlled DOCX ZIP local entries are truncated");
    }
    const flags = view.getUint16(offset + 6, true);
    const compressionMethod = view.getUint16(offset + 8, true);
    const expectedCrc = view.getUint32(offset + 14, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const uncompressedSize = view.getUint32(offset + 22, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    if ((flags & 0x08) !== 0) {
      fail("controlled DOCX ZIP data descriptors are not supported");
    }
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataStart < nameStart || dataEnd > content.byteLength) {
      fail("controlled DOCX ZIP entry is truncated");
    }
    let name: string;
    try {
      name = decoder.decode(content.subarray(nameStart, nameStart + nameLength));
    } catch {
      fail("controlled DOCX ZIP entry name is not valid UTF-8");
    }
    if (name === "" || names.has(name))
      fail("controlled DOCX ZIP contains an invalid duplicate entry");
    names.add(name);
    const compressed = content.subarray(dataStart, dataEnd);
    let uncompressed: Uint8Array;
    if (compressionMethod === 0) {
      uncompressed = compressed;
    } else if (compressionMethod === 8) {
      try {
        uncompressed = new Uint8Array(inflateRawSync(compressed));
      } catch {
        fail(`controlled DOCX ZIP entry ${name} cannot be decompressed`);
      }
    } else {
      fail(`controlled DOCX ZIP entry ${name} uses an unsupported compression method`);
    }
    if (uncompressed.length !== uncompressedSize || crc32(uncompressed) !== expectedCrc) {
      fail(`controlled DOCX ZIP entry ${name} failed its integrity check`);
    }
    entries.push({ name, content: uncompressed });
    offset = dataEnd;
  }
  if (!reachedCentralDirectory && !reachedEnd) {
    fail("controlled DOCX ZIP central directory is missing");
  }
  // The local entries are followed by a central directory and EOCD in every
  // controlled package. Requiring EOCD catches truncation after the last part.
  for (
    let index = Math.max(0, content.byteLength - 65_557);
    index + 22 <= content.byteLength;
    index += 1
  ) {
    if (littleEndian(content, index) === 0x06054b50) {
      reachedEnd = true;
      break;
    }
  }
  if (!reachedEnd || entries.length === 0) fail("controlled DOCX ZIP end record is missing");
  return entries;
}

function decodeXmlText(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function packagePath(sourcePart: string, target: string): string {
  const withoutFragment = target.split("#", 1)[0] ?? "";
  if (withoutFragment === "") return sourcePart;
  const segments = [
    ...(sourcePart === "" ? [] : sourcePart.split("/").slice(0, -1)),
    ...withoutFragment.replace(/^\/+/, "").split("/"),
  ];
  const normalized: string[] = [];
  for (const segment of segments) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (normalized.length === 0) fail("controlled DOCX relationship target escapes the package");
      normalized.pop();
    } else {
      normalized.push(segment);
    }
  }
  return normalized.join("/");
}

function relationshipSourcePart(name: string): string {
  if (name === "_rels/.rels") return "";
  const marker = "/_rels/";
  const markerIndex = name.indexOf(marker);
  if (markerIndex < 0 || !name.endsWith(".rels")) fail(`invalid relationship part ${name}`);
  return `${name.slice(0, markerIndex)}/${name.slice(markerIndex + marker.length, -5)}`;
}

function attribute(xml: string, name: string): string | undefined {
  return xml.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, "u"))?.[2];
}

function assertRelationships(entries: readonly ZipEntry[]): void {
  const entryNames = new Set(entries.map((entry) => entry.name));
  for (const entry of entries.filter((candidate) =>
    candidate.name.toLowerCase().endsWith(".rels"),
  )) {
    const xml = decodeUtf8(entry.content, `controlled DOCX relationship part ${entry.name}`);
    for (const match of xml.matchAll(/<Relationship\b([^>]*)\/?>(?:<\/Relationship>)?/gu)) {
      const attributes = match[1] ?? "";
      const target = attribute(attributes, "Target");
      if (target === undefined || target.trim() === "")
        fail(`relationship in ${entry.name} has no target`);
      if (attribute(attributes, "TargetMode")?.toLowerCase() === "external") continue;
      const resolved = packagePath(relationshipSourcePart(entry.name), decodeXmlText(target));
      if (!entryNames.has(resolved)) {
        fail(`controlled DOCX relationship target is missing: ${resolved}`);
      }
    }
  }
}

function targetPages(layoutProfile: string): number {
  if (layoutProfile === "compact-one-page") return 1;
  if (layoutProfile === "standard-two-page") return 2;
  fail(`unsupported rendering layout profile: ${layoutProfile}`);
}

function observationForPages(
  pages: readonly InspectedPage[],
  rendered: Pick<RenderedDocument, "content" | "metadata">,
  viewerName: string,
): RenderingQaViewerObservation {
  if (pages.length === 0) fail("controlled document has no inspectable pages");
  const units = pages.flatMap((page) => page.units);
  const sequence = contentSequence(units);
  const orphanSectionIds: string[] = [];
  for (const page of pages) {
    const last = page.units.at(-1);
    if (last?.kind === "heading") {
      fail("controlled document contains an orphaned section start");
    }
  }
  const sortedOrphans = [...new Set(orphanSectionIds)].sort((left, right) =>
    left.localeCompare(right),
  );
  const targetPageCount = targetPages(rendered.metadata.layoutProfile);
  const blankPageNumbers = pages
    .map((page, index) =>
      page.units.some((unit) => normalizeText(unit.text) !== "") ? null : index + 1,
    )
    .filter((page): page is number => page !== null);
  const overflowPageNumbers = pages
    .map((_, index) => (index + 1 > targetPageCount ? index + 1 : null))
    .filter((page): page is number => page !== null);
  const observation = renderingQaViewerObservationSchema.parse({
    renderedChecksum: rendered.metadata.checksum,
    viewerName,
    viewerVersion: "1.0.0",
    recoveredVisibleContentChecksum: sha256(sequence),
    recoveredVisibleContentCount: wordCount(sequence),
    recoveredVisibleContentOrder: "preserved",
    pageCount: pages.length,
    blankPageNumbers,
    overflowPageNumbers,
    orphanSectionIds: sortedOrphans,
    clippedText: pages.some((page) => page.clipped),
  });
  return observation;
}

function decodePdfLiteral(value: string): string {
  return value.replace(/\\([\\()nrtbf])/gu, (_, escaped: string) => {
    switch (escaped) {
      case "n":
        return "\n";
      case "r":
        return "\r";
      case "t":
        return "\t";
      case "b":
        return "\b";
      case "f":
        return "\f";
      default:
        return escaped;
    }
  });
}

function parsePdfPages(content: Uint8Array): readonly InspectedPage[] {
  const raw = decodeUtf8(content, "controlled PDF");
  if (!raw.startsWith("%PDF-")) fail("controlled PDF signature is missing");
  if (!raw.includes("startxref") || !raw.includes("%%EOF")) {
    fail("controlled PDF end-of-file marker is missing");
  }
  const objects = new Map<number, string>();
  for (const match of raw.matchAll(/\b(\d+)\s+0\s+obj\s*([\s\S]*?)\bendobj\b/gu)) {
    const id = Number(match[1]);
    const body = match[2];
    if (!Number.isSafeInteger(id) || body === undefined) fail("controlled PDF object is malformed");
    objects.set(id, body);
  }
  if (objects.size === 0) fail("controlled PDF contains no objects");
  const catalog = [...objects.values()].find((body) => /\/Type\s+\/Catalog(?:\s|\/|>)/u.test(body));
  const pagesId = Number(catalog?.match(/\/Pages\s+(\d+)\s+0\s+R/u)?.[1]);
  const pagesBody = Number.isSafeInteger(pagesId) ? objects.get(pagesId) : undefined;
  const kids = pagesBody?.match(/\/Kids\s*\[([^\]]*)\]/u)?.[1];
  const pageIds =
    kids === undefined
      ? [...objects.entries()]
          .filter(([, body]) => /\/Type\s+\/Page(?:\s|\/|>)/u.test(body))
          .map(([id]) => id)
      : [...kids.matchAll(/(\d+)\s+0\s+R/gu)].map((match) => Number(match[1]));
  if (pageIds.length === 0) fail("controlled PDF contains no page objects");
  const pages: InspectedPage[] = [];
  for (const pageId of pageIds) {
    const pageBody = objects.get(pageId);
    if (pageBody === undefined || !/\/Type\s+\/Page(?:\s|\/|>)/u.test(pageBody)) {
      fail("controlled PDF page tree contains an invalid page reference");
    }
    const mediaBox = pageBody.match(
      /\/MediaBox\s*\[\s*([-+]?\d+(?:\.\d+)?)\s+([-+]?\d+(?:\.\d+)?)\s+([-+]?\d+(?:\.\d+)?)\s+([-+]?\d+(?:\.\d+)?)\s*\]/u,
    );
    if (mediaBox === null) fail("controlled PDF page has no inspectable MediaBox");
    const x0 = Number(mediaBox[1]);
    const y0 = Number(mediaBox[2]);
    const x1 = Number(mediaBox[3]);
    const y1 = Number(mediaBox[4]);
    if (![x0, y0, x1, y1].every(Number.isFinite) || x1 <= x0 || y1 <= y0) {
      fail("controlled PDF page has an invalid MediaBox");
    }
    const contentId = Number(pageBody.match(/\/Contents\s+(\d+)\s+0\s+R/u)?.[1]);
    if (!Number.isSafeInteger(contentId)) {
      pages.push({ units: [], clipped: false });
      continue;
    }
    const contentBody = objects.get(contentId);
    const stream = contentBody?.match(/\bstream\s*\r?\n([\s\S]*?)\r?\nendstream\b/u)?.[1];
    if (stream === undefined) fail("controlled PDF page content stream is missing");
    const units: VisibleTextUnit[] = [];
    let clipped = false;
    for (const match of stream.matchAll(/\(((?:\\.|[^()])*)\)\s*Tj/gu)) {
      const escaped = match[1] ?? "";
      const text = decodePdfLiteral(escaped);
      const prefix = stream.slice(0, match.index ?? 0);
      const fontSizes = [...prefix.matchAll(/\/F1\s+([-+]?\d+(?:\.\d+)?)\s+Tf/gu)];
      const transforms = [
        ...prefix.matchAll(/1\s+0\s+0\s+1\s+([-+]?\d+(?:\.\d+)?)\s+([-+]?\d+(?:\.\d+)?)\s+Tm/gu),
      ];
      const fontSize = Number(fontSizes.at(-1)?.[1]);
      const x = Number(transforms.at(-1)?.[1]);
      const y = Number(transforms.at(-1)?.[2]);
      if (![fontSize, x, y].every(Number.isFinite))
        fail("controlled PDF text position is incomplete");
      const width = [...text].length * fontSize * 0.45;
      clipped ||= x < x0 || y - fontSize < y0 || y + fontSize > y1 || x + width > x1;
      units.push({ text, kind: fontSize >= 12 ? "heading" : "body" });
    }
    pages.push({ units, clipped });
  }
  return pages;
}

function parseDocxPages(content: Uint8Array): readonly InspectedPage[] {
  const entries = readZipEntries(content);
  assertRelationships(entries);
  const documentEntry = entries.find((entry) => entry.name === "word/document.xml");
  if (documentEntry === undefined) fail("controlled DOCX is missing word/document.xml");
  const raw = decodeUtf8(documentEntry.content, "controlled DOCX document.xml");
  const paragraphs = [...raw.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/gu)];
  const pages: { units: VisibleTextUnit[]; clipped: boolean }[] = [{ units: [], clipped: false }];
  for (const paragraph of paragraphs) {
    const xml = paragraph[1] ?? "";
    const text = [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/gu)]
      .map((match) => decodeXmlText(match[1] ?? ""))
      .join("");
    if (text !== "") {
      pages.at(-1)?.units.push({
        text,
        kind: /<w:pStyle\b[^>]*w:val\s*=\s*["']Heading1["']/u.test(xml) ? "heading" : "body",
      });
    }
    const pageBreaks = [
      ...xml.matchAll(/<w:br\b[^>]*w:type\s*=\s*["']page["'][^>]*\/?>(?:<\/w:br>)?/gu),
    ].length;
    for (let index = 0; index < pageBreaks; index += 1) pages.push({ units: [], clipped: false });
  }
  return pages;
}

/**
 * Inspect controlled PDF/DOCX bytes at the package boundary. This is a
 * deterministic byte inspector, not an exhaustive cross-viewer certification.
 */
export function inspectControlledDocument(
  rendered: Pick<RenderedDocument, "content" | "metadata">,
): RenderingQaViewerObservation {
  if (!(rendered.content instanceof Uint8Array)) fail("rendered content must be a Uint8Array");
  if (checksum(rendered.content) !== rendered.metadata.checksum) {
    fail("rendered metadata checksum does not match rendered content");
  }
  if (rendered.metadata.format === "pdf") {
    return observationForPages(
      parsePdfPages(rendered.content),
      rendered,
      "DraftLoop controlled PDF byte inspector",
    );
  }
  if (rendered.metadata.format === "docx") {
    return observationForPages(
      parseDocxPages(rendered.content),
      rendered,
      "DraftLoop controlled DOCX OOXML inspector",
    );
  }
  fail("controlled document inspection supports only PDF and DOCX");
}

/** Backward-friendly name for callers that use the rendered-document terminology. */
export const inspectRenderedDocument = inspectControlledDocument;
