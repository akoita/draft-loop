import { createHash } from "node:crypto";

import {
  type ArtifactValidationIssue,
  hasRequiredArtifactSection,
  validateArtifactReferences,
} from "@draft-loop/artifacts";
import type { DraftArtifact } from "@draft-loop/schemas";

export type OutputFormat = "markdown" | "pdf" | "docx";
export const outputFormats: readonly OutputFormat[] = ["markdown", "pdf", "docx"];
export const renderTemplateVersion = "cv-controlled-v1";
export type OutputExtension = ".md" | ".pdf" | ".docx";

export const supportedLanguages = ["en", "fr", "de", "es", "ja"] as const;
export type SupportedLanguage = (typeof supportedLanguages)[number];

export const localizedSectionHeadings: Readonly<Record<string, Readonly<Record<string, string>>>> =
  {
    en: {
      summary: "Professional Summary",
      experience: "Work Experience",
      education: "Education",
      skills: "Technical Skills",
      projects: "Key Projects",
      salutation: "Salutation",
      hook: "Introduction",
      alignment: "Core Alignment",
      closing: "Closing",
    },
    fr: {
      summary: "Résumé professionnel",
      experience: "Expérience professionnelle",
      education: "Formation",
      skills: "Compétences techniques",
      projects: "Projets clés",
      salutation: "Salutation",
      hook: "Introduction",
      alignment: "Adéquation au poste",
      closing: "Conclusion",
    },
    de: {
      summary: "Beruflicher Werdegang",
      experience: "Berufserfahrung",
      education: "Ausbildung",
      skills: "Fachkenntnisse",
      projects: "Wichtige Projekte",
      salutation: "Anrede",
      hook: "Einleitung",
      alignment: "Qualifikationsabgleich",
      closing: "Schlussformel",
    },
    es: {
      summary: "Resumen profesional",
      experience: "Experiencia laboral",
      education: "Educación",
      skills: "Habilidades técnicas",
      projects: "Proyectos destacados",
      salutation: "Saludo",
      hook: "Introducción",
      alignment: "Alineación con el puesto",
      closing: "Cierre",
    },
    ja: {
      summary: "職務要約",
      experience: "職務経歴",
      education: "学歴",
      skills: "スキル・専門知識",
      projects: "主なプロジェクト",
      salutation: "頭語",
      hook: "志望動機",
      alignment: "適性・実績",
      closing: "結語",
    },
  };

export const localizedDocumentTitles: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  en: {
    cv: "DraftLoop Tailored CV",
    "cover-letter": "DraftLoop Cover Letter",
    "application-qa": "DraftLoop Application Q&A",
  },
  fr: {
    cv: "CV personnalisé DraftLoop",
    "cover-letter": "Lettre de motivation DraftLoop",
    "application-qa": "Questions-réponses DraftLoop",
  },
  de: {
    cv: "DraftLoop Lebenslauf",
    "cover-letter": "DraftLoop Anschreiben",
    "application-qa": "DraftLoop Bewerbungsfragen",
  },
  es: {
    cv: "Curriculum Vitae DraftLoop",
    "cover-letter": "Carta de presentación DraftLoop",
    "application-qa": "Preguntas y respuestas DraftLoop",
  },
  ja: {
    cv: "DraftLoop 履歴書",
    "cover-letter": "DraftLoop 送付状",
    "application-qa": "DraftLoop 応募質問回答",
  },
};

export function getLocalizedSectionTitle(
  kind: string,
  language = "en",
  customTitle?: string,
): string {
  const langKey = language.toLowerCase().slice(0, 2);
  const langTable = localizedSectionHeadings[langKey] ?? localizedSectionHeadings.en;
  if (customTitle && customTitle.trim() !== "") {
    return customTitle;
  }
  return langTable?.[kind] ?? customTitle ?? kind;
}

export function getLocalizedDocumentTitle(artifactKind = "cv", language = "en"): string {
  const langKey = language.toLowerCase().slice(0, 2);
  const langTable = localizedDocumentTitles[langKey] ?? localizedDocumentTitles.en;
  return langTable?.[artifactKind] ?? langTable?.cv ?? "DraftLoop CV";
}

export function extensionForFormat(format: OutputFormat): OutputExtension {
  return format === "markdown" ? ".md" : `.${format}`;
}

export interface RenderConstraints {
  readonly requiredSections?: readonly string[];
  readonly maxWords?: number;
  readonly maxCharacters?: number;
  readonly maxLength?: number;
  /**
   * Allows an explicitly approved artifact to retain substantive claims that
   * have no source reference. Callers must enforce the human approval gate
   * before enabling this exception.
   */
  readonly allowUnbackedClaims?: boolean;
}

export interface RenderValidationIssue {
  readonly code:
    | ArtifactValidationIssue["code"]
    | "missing-required-section"
    | "max-words-exceeded"
    | "max-characters-exceeded"
    | "max-length-exceeded";
  readonly message: string;
  readonly path: string;
}

export interface RenderOptions extends RenderConstraints {
  readonly generatedAt?: string;
  readonly templateVersion?: string;
}

export interface RenderMetadata {
  readonly artifactId: string;
  readonly artifactVersion: number;
  readonly format: OutputFormat;
  readonly generatedAt: string;
  readonly templateVersion: string;
  readonly checksum: string;
}

export interface RenderedDocument {
  readonly content: Uint8Array;
  readonly extension: OutputExtension;
  readonly mimeType: string;
  readonly metadata: RenderMetadata;
}

export interface AtsValidationReport {
  readonly format: OutputFormat;
  readonly recoveredText: string;
  readonly expectedWordCount: number;
  readonly recoveredWordCount: number;
  readonly tokenRecoveryRate: number;
  readonly missingSections: readonly string[];
  readonly passed: boolean;
}

export class ArtifactExportValidationError extends Error {
  readonly issues: readonly RenderValidationIssue[];

  constructor(issues: readonly RenderValidationIssue[]) {
    super(`Artifact cannot be exported: ${issues.map((issue) => issue.message).join("; ")}`);
    this.name = "ArtifactExportValidationError";
    this.issues = issues;
  }
}

function artifactText(artifact: DraftArtifact): string {
  return artifact.sections
    .slice()
    .sort((left, right) => left.order - right.order)
    .flatMap((section) => section.blocks.map((block) => block.text))
    .join("\n");
}

function wordCount(value: string): number {
  const trimmed = value.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/u).length;
}

export function validateArtifactForExport(
  artifact: DraftArtifact,
  constraints: RenderConstraints = {},
): readonly RenderValidationIssue[] {
  const issues: RenderValidationIssue[] = validateArtifactReferences(artifact)
    .filter((issue) => !constraints.allowUnbackedClaims || issue.code !== "unbacked-claim")
    .map((issue) => ({
      code: issue.code,
      message: issue.message,
      path: issue.path,
    }));
  for (const requiredSection of constraints.requiredSections ?? []) {
    if (!hasRequiredArtifactSection(artifact, requiredSection)) {
      issues.push({
        code: "missing-required-section",
        message: `required section ${requiredSection} is missing`,
        path: "sections",
      });
    }
  }

  const text = artifactText(artifact);
  if (constraints.maxWords !== undefined && wordCount(text) > constraints.maxWords) {
    issues.push({
      code: "max-words-exceeded",
      message: `artifact has ${wordCount(text)} words; maximum is ${constraints.maxWords}`,
      path: "sections",
    });
  }
  if (constraints.maxCharacters !== undefined && text.length > constraints.maxCharacters) {
    issues.push({
      code: "max-characters-exceeded",
      message: `artifact has ${text.length} characters; maximum is ${constraints.maxCharacters}`,
      path: "sections",
    });
  }
  if (constraints.maxLength !== undefined && text.length > constraints.maxLength) {
    issues.push({
      code: "max-length-exceeded",
      message: `artifact has length ${text.length}; maximum is ${constraints.maxLength}`,
      path: "sections",
    });
  }
  return Object.freeze(issues);
}

function assertExportable(artifact: DraftArtifact, constraints: RenderConstraints): void {
  const issues = validateArtifactForExport(artifact, constraints);
  if (issues.length > 0) throw new ArtifactExportValidationError(issues);
}

export function renderMarkdown(artifact: DraftArtifact): string {
  const sections = [...artifact.sections].sort((left, right) => left.order - right.order);
  if (artifact.kind === "cover-letter") {
    return `${sections
      .map((section) => {
        const blocks = section.blocks
          .map((block) => (block.type === "bullet" ? `- ${block.text}` : block.text))
          .join("\n\n");
        if (section.kind === "salutation" || section.kind === "closing") {
          return blocks;
        }
        return `## ${section.title}\n\n${blocks}`;
      })
      .join("\n\n")}\n`;
  }
  if (artifact.kind === "application-qa") {
    return `${sections
      .map((section) => {
        const blocks = section.blocks
          .map((block) => (block.type === "bullet" ? `- ${block.text}` : block.text))
          .join("\n\n");
        return `### ${section.title}\n\n${blocks}`;
      })
      .join("\n\n")}\n`;
  }
  return `${sections
    .map((section) => {
      const blocks = section.blocks
        .map((block) => (block.type === "bullet" ? `- ${block.text}` : block.text))
        .join("\n\n");
      return `## ${section.title}\n\n${blocks}`;
    })
    .join("\n\n")}\n`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderHtml(artifact: DraftArtifact): string {
  const sections = [...artifact.sections]
    .sort((left, right) => left.order - right.order)
    .map((section) => {
      const blocks = section.blocks
        .map((block) => {
          const tag = block.type === "bullet" ? "li" : "p";
          return `<${tag}>${escapeHtml(block.text)}</${tag}>`;
        })
        .join("");
      const list = section.blocks.some((block) => block.type === "bullet")
        ? `<ul>${blocks}</ul>`
        : blocks;
      return `<section><h2>${escapeHtml(section.title)}</h2>${list}</section>`;
    })
    .join("");
  const documentTitle = getLocalizedDocumentTitle(artifact.kind ?? "cv", artifact.language);
  return `<!doctype html><html lang="${escapeHtml(artifact.language)}"><head><meta charset="utf-8"><title>${escapeHtml(documentTitle)}</title><style>${controlledCss}</style></head><body><main>${sections}</main></body></html>`;
}

const controlledCss = `
@page { size: A4; margin: 18mm; }
body { color: #1e2932; font-family: Arial, sans-serif; font-size: 10.5pt; line-height: 1.42; }
main { max-width: 174mm; margin: 0 auto; }
h2 { margin: 18pt 0 7pt; border-bottom: 1px solid #94a3ad; padding-bottom: 3pt; font-size: 14pt; }
p, li { margin: 0 0 5pt; }
ul { margin: 0 0 5pt; padding-left: 17pt; }
`;

interface LayoutLine {
  readonly text: string;
  readonly kind: "heading" | "body" | "bullet";
}

function wrapText(text: string, maxCharacters: number): readonly string[] {
  const words = text.split(/\s+/u);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line !== "" && line.length + word.length + 1 > maxCharacters) {
      lines.push(line);
      line = word;
    } else {
      line = line === "" ? word : `${line} ${word}`;
    }
  }
  if (line !== "") lines.push(line);
  return lines.length === 0 ? [""] : lines;
}

function layoutLines(artifact: DraftArtifact): readonly LayoutLine[] {
  const lines: LayoutLine[] = [];
  for (const section of [...artifact.sections].sort((left, right) => left.order - right.order)) {
    lines.push({ text: section.title, kind: "heading" });
    for (const block of section.blocks) {
      const prefix = block.type === "bullet" ? "• " : "";
      const wrapped = wrapText(block.text, block.type === "bullet" ? 82 : 88);
      wrapped.forEach((line, index) => {
        lines.push({ text: `${index === 0 ? prefix : "  "}${line}`, kind: "body" });
      });
    }
    lines.push({ text: "", kind: "body" });
  }
  return lines;
}

function escapePdfText(value: string): string {
  const normalized = value
    .replaceAll("“", '"')
    .replaceAll("”", '"')
    .replaceAll("‘", "'")
    .replaceAll("’", "'")
    .replaceAll("—", " - ")
    .replaceAll("–", " - ")
    .replaceAll("•", "*")
    .replaceAll("…", "...");
  const ascii = normalized
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\x20-\x7e]/gu, "?");
  return ascii.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

function pdfBytes(artifact: DraftArtifact, options: RenderOptions = {}): Uint8Array {
  const lines = layoutLines(artifact);
  const pages: readonly LayoutLine[][] = (() => {
    const result: LayoutLine[][] = [[]];
    let used = 0;
    for (const line of lines) {
      const height = line.kind === "heading" ? 25 : 16;
      if (used + height > 730 && result.at(-1)?.length !== 0) {
        result.push([]);
        used = 0;
      }
      result.at(-1)?.push(line);
      used += height;
    }
    return result;
  })();
  const objects: string[] = [];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = "";
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  const pageIds: number[] = [];
  for (const page of pages) {
    const pageId = objects.length;
    const contentId = pageId + 1;
    pageIds.push(pageId);
    let y = 790;
    const commands = ["BT"];
    for (const line of page) {
      if (line.kind === "heading") {
        commands.push(`/F1 16 Tf 1 0 0 1 56 ${y} Tm (${escapePdfText(line.text)}) Tj`);
        y -= 25;
      } else {
        commands.push(`/F1 10 Tf 1 0 0 1 56 ${y} Tm (${escapePdfText(line.text)}) Tj`);
        y -= 16;
      }
    }
    commands.push("ET");
    const stream = commands.join("\n");
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] =
      `<< /Length ${new TextEncoder().encode(stream).length} >>\nstream\n${stream}\nendstream`;
  }
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

  const infoId = objects.length;
  const createdDateStr = options.generatedAt
    ? options.generatedAt.replace(/[-:TZ.]/gu, "").slice(0, 14)
    : "20260813120000";
  const defaultTitle = getLocalizedDocumentTitle(artifact.kind ?? "cv", artifact.language);
  const title = artifact.sections[0]?.title ?? defaultTitle;
  objects[infoId] =
    `<< /Title (${escapePdfText(title)}) /Author (DraftLoop) /Creator (DraftLoop CV Engine) /CreationDate (D:${createdDateStr}Z) >>`;

  let pdf = "%PDF-1.4\n%\xFF\xFF\xFF\xFF\n";
  const offsets: number[] = [0];
  for (let index = 1; index < objects.length; index += 1) {
    offsets[index] = pdf.length;
    pdf += `${index} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let index = 1; index < objects.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
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

function littleEndian(value: number, length: number): Uint8Array {
  const result = new Uint8Array(length);
  let remaining = value >>> 0;
  for (let index = 0; index < length; index += 1) {
    result[index] = remaining & 0xff;
    remaining >>>= 8;
  }
  return result;
}

function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function zipStored(entries: Readonly<Record<string, string>>): Uint8Array {
  const encoder = new TextEncoder();
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const nameBytes = encoder.encode(name);
    const contentBytes = encoder.encode(content);
    const header = concatBytes(
      new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
      littleEndian(20, 2),
      new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]),
      littleEndian(crc32(contentBytes), 4),
      littleEndian(contentBytes.length, 4),
      littleEndian(contentBytes.length, 4),
      littleEndian(nameBytes.length, 2),
      littleEndian(0, 2),
      nameBytes,
      contentBytes,
    );
    local.push(header);
    const directory = concatBytes(
      new Uint8Array([0x50, 0x4b, 0x01, 0x02]),
      littleEndian(20, 2),
      littleEndian(20, 2),
      new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]),
      littleEndian(crc32(contentBytes), 4),
      littleEndian(contentBytes.length, 4),
      littleEndian(contentBytes.length, 4),
      littleEndian(nameBytes.length, 2),
      littleEndian(0, 2),
      littleEndian(0, 2),
      littleEndian(0, 2),
      littleEndian(0, 2),
      littleEndian(0, 4),
      littleEndian(offset, 4),
      nameBytes,
    );
    central.push(directory);
    offset += header.length;
  }
  const localBytes = concatBytes(...local);
  const centralBytes = concatBytes(...central);
  const end = concatBytes(
    new Uint8Array([0x50, 0x4b, 0x05, 0x06]),
    littleEndian(0, 2),
    littleEndian(0, 2),
    littleEndian(central.length, 2),
    littleEndian(central.length, 2),
    littleEndian(centralBytes.length, 4),
    littleEndian(localBytes.length, 4),
    littleEndian(0, 2),
  );
  return concatBytes(localBytes, centralBytes, end);
}

function renderDocx(artifact: DraftArtifact, options: RenderOptions = {}): Uint8Array {
  const body = [...artifact.sections]
    .sort((left, right) => left.order - right.order)
    .map((section) => {
      const heading = `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t xml:space="preserve">${escapeHtml(section.title)}</w:t></w:r></w:p>`;
      const blocks = section.blocks
        .map((block) => {
          const style =
            block.type === "bullet" ? `<w:pPr><w:pStyle w:val="ListBullet"/></w:pPr>` : "";
          return `<w:p>${style}<w:r><w:t xml:space="preserve">${escapeHtml(block.text)}</w:t></w:r></w:p>`;
        })
        .join("");
      return `${heading}${blocks}`;
    })
    .join("");
  const defaultTitle = getLocalizedDocumentTitle(artifact.kind ?? "cv", artifact.language);
  const title = artifact.sections[0]?.title ?? defaultTitle;
  const createdDate = options.generatedAt ?? "2026-08-13T12:00:00.000Z";
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1008" w:right="1008" w:bottom="1008" w:left="1008"/></w:sectPr></w:body></w:document>`;
  const coreProps = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/coreProperties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escapeHtml(title)}</dc:title><dc:creator>DraftLoop</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${createdDate}</dcterms:created></cp:coreProperties>`;

  return zipStored({
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
    "word/_rels/document.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    "word/document.xml": document,
    "word/styles.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:basedOn w:val="Normal"/></w:style></w:styles>`,
    "docProps/core.xml": coreProps,
  });
}

function bytesForFormat(
  artifact: DraftArtifact,
  format: OutputFormat,
  options: RenderOptions = {},
): Uint8Array {
  if (format === "markdown") return new TextEncoder().encode(renderMarkdown(artifact));
  if (format === "pdf") return pdfBytes(artifact, options);
  return renderDocx(artifact, options);
}

export function extractTextFromRenderedDocument(rendered: RenderedDocument): string {
  const decoder = new TextDecoder();
  if (rendered.metadata.format === "markdown") {
    return decoder.decode(rendered.content);
  }
  if (rendered.metadata.format === "pdf") {
    const raw = decoder.decode(rendered.content);
    const textChunks: string[] = [];
    const tjPattern = /\(((?:\\\(|\\\)|\\\\|[^()])*)\)\s*Tj/gu;
    for (const match of raw.matchAll(tjPattern)) {
      const escaped = match[1] ?? "";
      const unescaped = escaped
        .replaceAll("\\(", "(")
        .replaceAll("\\)", ")")
        .replaceAll("\\\\", "\\");
      textChunks.push(unescaped);
    }
    return textChunks.join(" ");
  }
  if (rendered.metadata.format === "docx") {
    const raw = decoder.decode(rendered.content);
    const textChunks: string[] = [];
    const wtPattern = /<w:t[^>]*>(.*?)<\/w:t>/gu;
    for (const match of raw.matchAll(wtPattern)) {
      const xmlEncoded = match[1] ?? "";
      const text = xmlEncoded
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replaceAll("&quot;", '"')
        .replaceAll("&apos;", "'")
        .replaceAll("&amp;", "&");
      textChunks.push(text);
    }
    return textChunks.join(" ");
  }
  return "";
}

export function validateAtsExtractability(
  rendered: RenderedDocument,
  artifact: DraftArtifact,
): AtsValidationReport {
  const extracted = extractTextFromRenderedDocument(rendered);
  const normalizeText = (text: string) =>
    text.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  const normalizedExtracted = normalizeText(extracted);

  const expectedText = artifactText(artifact);
  const expectedWords = wordCount(expectedText);
  const recoveredWords = wordCount(extracted);

  const missingSections: string[] = [];
  for (const section of artifact.sections) {
    const isHeaderlessLetterSection =
      artifact.kind === "cover-letter" &&
      (section.kind === "salutation" || section.kind === "closing");
    if (isHeaderlessLetterSection) {
      const firstBlockWord = normalizeText(
        section.blocks[0]?.text.toLowerCase().trim().split(/\s+/u)[0] ?? "",
      );
      if (firstBlockWord !== "" && !normalizedExtracted.includes(firstBlockWord)) {
        missingSections.push(section.title);
      }
    } else if (!normalizedExtracted.includes(normalizeText(section.title))) {
      missingSections.push(section.title);
    }
  }

  const expectedTokens = [...normalizeText(expectedText).matchAll(/[\p{L}\p{N}]+/gu)].map(
    (m) => m[0],
  );
  let matched = 0;
  for (const token of expectedTokens) {
    if (normalizedExtracted.includes(token)) {
      matched++;
    }
  }
  const tokenRecoveryRate = expectedTokens.length > 0 ? matched / expectedTokens.length : 1.0;

  const passed = tokenRecoveryRate >= 0.85 && missingSections.length === 0;

  return {
    format: rendered.metadata.format,
    recoveredText: extracted,
    expectedWordCount: expectedWords,
    recoveredWordCount: recoveredWords,
    tokenRecoveryRate: Number(tokenRecoveryRate.toFixed(4)),
    missingSections,
    passed,
  };
}

export function renderArtifact(
  artifact: DraftArtifact,
  format: OutputFormat,
  options: RenderOptions = {},
): RenderedDocument {
  assertExportable(artifact, options);
  const content = bytesForFormat(artifact, format, options);
  const checksum = createHash("sha256").update(content).digest("hex");
  const metadata: RenderMetadata = {
    artifactId: artifact.id,
    artifactVersion: artifact.version,
    format,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    templateVersion: options.templateVersion ?? renderTemplateVersion,
    checksum,
  };
  const mimeType =
    format === "markdown"
      ? "text/markdown; charset=utf-8"
      : format === "pdf"
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  return Object.freeze({
    content,
    extension: extensionForFormat(format),
    mimeType,
    metadata: Object.freeze(metadata),
  });
}
