import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";

import {
  type ArtifactValidationIssue,
  hasRequiredArtifactSection,
  validateArtifactReferences,
} from "@draft-loop/artifacts";
import {
  type DraftArtifact,
  draftArtifactSchema,
  type RenderingLayoutProfileId,
  type RenderingQaReport,
  type RenderingQaViewerObservation,
  renderingLayoutProfileIds,
  renderingQaActiveContentSignatures,
  renderingQaLimitationCodes,
  renderingQaRenderedMetadataSchema,
  renderingQaReportSchema,
  renderingQaViewerObservationSchema,
} from "@draft-loop/schemas";

export type OutputFormat = "markdown" | "pdf" | "docx";
export const outputFormats: readonly OutputFormat[] = ["markdown", "pdf", "docx"];
export const renderTemplateVersion = "cv-controlled-v1";
export type OutputExtension = ".md" | ".pdf" | ".docx";

export const defaultLayoutProfileId: RenderingLayoutProfileId = "standard-two-page";

export interface RenderingLayoutProfile {
  readonly id: RenderingLayoutProfileId;
  readonly pageWidthMm: 210;
  readonly pageHeightMm: 297;
  readonly marginsMm: {
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
    readonly left: number;
  };
  readonly typography: {
    readonly fontFamily: string;
    readonly bodyFontSizePt: number;
    readonly headingFontSizePt: number;
    readonly lineHeight: number;
  };
  readonly lineMetricsPt: {
    readonly body: number;
    readonly heading: number;
  };
  readonly wrapping: {
    readonly bodyMaxCharacters: number;
    readonly bulletMaxCharacters: number;
  };
  readonly targetMaxPages: 1 | 2;
}

const layoutProfileTable: Readonly<Record<RenderingLayoutProfileId, RenderingLayoutProfile>> = {
  "compact-one-page": {
    id: "compact-one-page",
    pageWidthMm: 210,
    pageHeightMm: 297,
    marginsMm: { top: 12, right: 12, bottom: 12, left: 12 },
    typography: {
      fontFamily: "Arial, sans-serif",
      bodyFontSizePt: 9.5,
      headingFontSizePt: 13,
      lineHeight: 1.25,
    },
    lineMetricsPt: { body: 12, heading: 21 },
    wrapping: { bodyMaxCharacters: 96, bulletMaxCharacters: 90 },
    targetMaxPages: 1,
  },
  "standard-two-page": {
    id: "standard-two-page",
    pageWidthMm: 210,
    pageHeightMm: 297,
    marginsMm: { top: 18, right: 18, bottom: 18, left: 18 },
    typography: {
      fontFamily: "Arial, sans-serif",
      bodyFontSizePt: 10.5,
      headingFontSizePt: 14,
      lineHeight: 1.42,
    },
    lineMetricsPt: { body: 16, heading: 25 },
    wrapping: { bodyMaxCharacters: 88, bulletMaxCharacters: 82 },
    targetMaxPages: 2,
  },
};

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

/** Immutable profiles used by every controlled output format. */
export const renderingLayoutProfiles = deepFreeze(layoutProfileTable);

function getRenderingLayoutProfile(profileId: string | undefined): RenderingLayoutProfile {
  const selected = profileId ?? defaultLayoutProfileId;
  if (!renderingLayoutProfileIds.includes(selected as RenderingLayoutProfileId)) {
    throw new RangeError(`Unknown rendering layout profile: ${selected}`);
  }
  const profile = renderingLayoutProfiles[selected as RenderingLayoutProfileId];
  if (profile === undefined) {
    throw new RangeError(`Unknown rendering layout profile: ${selected}`);
  }
  return profile;
}

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
  readonly layoutProfile?: RenderingLayoutProfileId;
}

export interface RenderMetadata {
  readonly artifactId: string;
  readonly artifactVersion: number;
  readonly format: OutputFormat;
  readonly generatedAt: string;
  readonly templateVersion: string;
  readonly layoutProfile: RenderingLayoutProfileId;
  readonly checksum: string;
  readonly sourceContentChecksum: string;
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

function orderedSections(artifact: DraftArtifact): readonly DraftArtifact["sections"][number][] {
  return artifact.sections.slice().sort((left, right) => left.order - right.order);
}

function artifactText(artifact: DraftArtifact): string {
  return orderedSections(artifact)
    .flatMap((section) => section.blocks.map((block) => block.text))
    .join("\n");
}

function canonicalArtifactContent(artifact: DraftArtifact): string {
  return JSON.stringify({
    kind: artifact.kind ?? "cv",
    language: artifact.language,
    sections: orderedSections(artifact).map((section) => ({
      title: section.title,
      kind: section.kind,
      blocks: section.blocks.map((block) => ({
        type: block.type,
        text: block.text,
      })),
    })),
  });
}

/** SHA-256 binding for the exact ordered content controlled by the renderer. */
export function computeArtifactContentChecksum(artifact: DraftArtifact): string {
  return createHash("sha256").update(canonicalArtifactContent(artifact)).digest("hex");
}

function assertCanonicalOptionKeys(options: RenderOptions): void {
  const allowedKeys = new Set([
    "requiredSections",
    "maxWords",
    "maxCharacters",
    "maxLength",
    "allowUnbackedClaims",
    "generatedAt",
    "layoutProfile",
  ]);
  for (const key of Object.keys(options as object)) {
    if (!allowedKeys.has(key)) {
      throw new TypeError(`Unknown render option: ${key}`);
    }
  }
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

export function renderMarkdown(artifact: DraftArtifact, options: RenderOptions = {}): string {
  assertCanonicalOptionKeys(options);
  getRenderingLayoutProfile(options.layoutProfile);
  const sections = orderedSections(artifact);
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

export function renderHtml(artifact: DraftArtifact, options: RenderOptions = {}): string {
  assertCanonicalOptionKeys(options);
  const profile = getRenderingLayoutProfile(options.layoutProfile);
  const sections = orderedSections(artifact)
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
  return `<!doctype html><html lang="${escapeHtml(artifact.language)}"><head><meta charset="utf-8"><title>${escapeHtml(documentTitle)}</title><style>${controlledCss(profile)}</style></head><body><main>${sections}</main></body></html>`;
}

function controlledCss(profile: RenderingLayoutProfile): string {
  const {
    top: topMargin,
    right: rightMargin,
    bottom: bottomMargin,
    left: leftMargin,
  } = profile.marginsMm;
  const contentWidth = profile.pageWidthMm - leftMargin - rightMargin;
  const headingMargin = profile.lineMetricsPt.heading - profile.lineMetricsPt.body;
  return `
@page { size: A4; margin: ${topMargin}mm ${rightMargin}mm ${bottomMargin}mm ${leftMargin}mm; }
body { color: #1e2932; font-family: ${profile.typography.fontFamily}; font-size: ${profile.typography.bodyFontSizePt}pt; line-height: ${profile.typography.lineHeight}; }
main { max-width: ${contentWidth}mm; margin: 0 auto; }
h2 { margin: ${headingMargin}pt 0 7pt; border-bottom: 1px solid #94a3ad; padding-bottom: 3pt; font-size: ${profile.typography.headingFontSizePt}pt; }
p, li { margin: 0 0 5pt; }
ul { margin: 0 0 5pt; padding-left: 17pt; }
`;
}

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

function layoutLines(
  artifact: DraftArtifact,
  profile: RenderingLayoutProfile,
): readonly LayoutLine[] {
  const lines: LayoutLine[] = [];
  for (const section of orderedSections(artifact)) {
    lines.push({ text: section.title, kind: "heading" });
    for (const block of section.blocks) {
      const prefix = block.type === "bullet" ? "• " : "";
      const wrapped = wrapText(
        block.text,
        block.type === "bullet"
          ? profile.wrapping.bulletMaxCharacters
          : profile.wrapping.bodyMaxCharacters,
      );
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
  const profile = getRenderingLayoutProfile(options.layoutProfile);
  const pageWidthPt = (profile.pageWidthMm * 72) / 25.4;
  const pageHeightPt = (profile.pageHeightMm * 72) / 25.4;
  const leftMarginPt = (profile.marginsMm.left * 72) / 25.4;
  const topMarginPt = (profile.marginsMm.top * 72) / 25.4;
  const bottomMarginPt = (profile.marginsMm.bottom * 72) / 25.4;
  const lines = layoutLines(artifact, profile);
  const pages: readonly LayoutLine[][] = (() => {
    const result: LayoutLine[][] = [[]];
    let used = 0;
    const availableHeight = pageHeightPt - topMarginPt - bottomMarginPt;
    for (const line of lines) {
      const height =
        line.kind === "heading" ? profile.lineMetricsPt.heading : profile.lineMetricsPt.body;
      if (used + height > availableHeight && result.at(-1)?.length !== 0) {
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
    let y = pageHeightPt - topMarginPt;
    const commands = ["BT"];
    for (const line of page) {
      if (line.kind === "heading") {
        commands.push(
          `/F1 ${profile.typography.headingFontSizePt} Tf 1 0 0 1 ${leftMarginPt.toFixed(4)} ${y.toFixed(4)} Tm (${escapePdfText(line.text)}) Tj`,
        );
        y -= profile.lineMetricsPt.heading;
      } else {
        commands.push(
          `/F1 ${profile.typography.bodyFontSizePt} Tf 1 0 0 1 ${leftMarginPt.toFixed(4)} ${y.toFixed(4)} Tm (${escapePdfText(line.text)}) Tj`,
        );
        y -= profile.lineMetricsPt.body;
      }
    }
    commands.push("ET");
    const stream = commands.join("\n");
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidthPt.toFixed(4)} ${pageHeightPt.toFixed(4)}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
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
  const profile = getRenderingLayoutProfile(options.layoutProfile);
  const body = orderedSections(artifact)
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
  const marginTwips = (millimeters: number): number => Math.round(millimeters * 56.6929134);
  const { top, right, bottom, left } = profile.marginsMm;
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="${marginTwips(top)}" w:right="${marginTwips(right)}" w:bottom="${marginTwips(bottom)}" w:left="${marginTwips(left)}"/></w:sectPr></w:body></w:document>`;
  const coreProps = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/coreProperties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escapeHtml(title)}</dc:title><dc:creator>DraftLoop</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${createdDate}</dcterms:created></cp:coreProperties>`;

  return zipStored({
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
    "word/_rels/document.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    "word/document.xml": document,
    "word/styles.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="${Math.round(profile.typography.bodyFontSizePt * 2)}"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="${Math.round(profile.typography.headingFontSizePt * 2)}"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:basedOn w:val="Normal"/></w:style></w:styles>`,
    "docProps/core.xml": coreProps,
  });
}

function bytesForFormat(
  artifact: DraftArtifact,
  format: OutputFormat,
  options: RenderOptions = {},
): Uint8Array {
  if (format === "markdown") return new TextEncoder().encode(renderMarkdown(artifact, options));
  if (format === "pdf") return pdfBytes(artifact, options);
  return renderDocx(artifact, options);
}

interface VisibleTextUnit {
  readonly text: string;
  readonly kind: "heading" | "body";
}

function decodePdfText(value: string): string {
  return value.replaceAll("\\(", "(").replaceAll("\\)", ")").replaceAll("\\\\", "\\");
}

function decodeXmlText(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function extractMarkdownUnits(raw: string): readonly VisibleTextUnit[] {
  const units: VisibleTextUnit[] = [];
  for (const line of raw.split(/\r?\n/u)) {
    const heading = line.match(/^#{2,3}\s+(.+?)\s*$/u);
    if (heading?.[1] !== undefined) {
      units.push({ text: heading[1], kind: "heading" });
      continue;
    }
    const body = line.replace(/^\s*[-*•]\s+/u, "").trim();
    if (body !== "") units.push({ text: body, kind: "body" });
  }
  return units;
}

function extractPdfUnits(raw: string): readonly VisibleTextUnit[] {
  const units: VisibleTextUnit[] = [];
  const tjPattern = /\(((?:\\.|[^()])*)\)\s*Tj/gu;
  for (const match of raw.matchAll(tjPattern)) {
    const escaped = match[1] ?? "";
    const start = match.index ?? 0;
    const lineStart = raw.lastIndexOf("\n", start) + 1;
    const prefix = raw.slice(lineStart, start);
    const fontSize = Number(prefix.match(/\/F1\s+([0-9.]+)\s+Tf/u)?.[1] ?? 0);
    units.push({
      text: decodePdfText(escaped),
      kind: fontSize >= 12 ? "heading" : "body",
    });
  }
  return units;
}

function extractDocxUnits(raw: string): readonly VisibleTextUnit[] {
  const units: VisibleTextUnit[] = [];
  const paragraphPattern = /<w:p(?:\s[^>]*)?>(.*?)<\/w:p>/gs;
  for (const paragraph of raw.matchAll(paragraphPattern)) {
    const xmlParagraph = paragraph[1] ?? "";
    const texts: string[] = [];
    for (const match of xmlParagraph.matchAll(/<w:t[^>]*>(.*?)<\/w:t>/gs)) {
      texts.push(decodeXmlText(match[1] ?? ""));
    }
    const text = texts.join("");
    if (text !== "") {
      units.push({
        text,
        kind: /w:pStyle\s+w:val="Heading1"/u.test(xmlParagraph) ? "heading" : "body",
      });
    }
  }
  return units;
}

function extractVisibleTextUnits(rendered: RenderedDocument): readonly VisibleTextUnit[] {
  const decoder = new TextDecoder();
  const raw = decoder.decode(rendered.content);
  if (rendered.metadata.format === "markdown") {
    return extractMarkdownUnits(raw);
  }
  if (rendered.metadata.format === "pdf") {
    return extractPdfUnits(raw);
  }
  if (rendered.metadata.format === "docx") {
    return extractDocxUnits(raw);
  }
  return [];
}

export function extractTextFromRenderedDocument(rendered: RenderedDocument): string {
  if (rendered.metadata.format === "markdown") {
    return new TextDecoder().decode(rendered.content);
  }
  return extractVisibleTextUnits(rendered)
    .map((unit) => unit.text)
    .join(" ");
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

function normalizeVisibleText(text: string): string {
  return text
    .replace(/^\s*[-*•]\s+/u, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function normalizedSequence(units: readonly VisibleTextUnit[]): string {
  return units
    .map((unit) => normalizeVisibleText(unit.text))
    .filter((text) => text !== "")
    .join(" ");
}

function visibleWordCount(text: string): number {
  const normalized = normalizeVisibleText(text);
  return normalized === "" ? 0 : normalized.split(/\s+/u).length;
}

function expectedVisibleTextUnits(
  artifact: DraftArtifact,
  format: OutputFormat,
): readonly VisibleTextUnit[] {
  const includeHeading = (section: DraftArtifact["sections"][number]): boolean =>
    !(
      format === "markdown" &&
      artifact.kind === "cover-letter" &&
      (section.kind === "salutation" || section.kind === "closing")
    );
  return orderedSections(artifact).flatMap((section) => {
    const heading = includeHeading(section)
      ? [{ text: section.title, kind: "heading" as const }]
      : [];
    const blocks = section.blocks.map((block) => ({ text: block.text, kind: "body" as const }));
    return [...heading, ...blocks];
  });
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function inspectPdfPageCount(content: Uint8Array): number | null {
  const raw = new TextDecoder().decode(content);
  const pages = [...raw.matchAll(/\b\d+\s+0\s+obj\s+([\s\S]*?)\bendobj\b/gu)].filter((match) => {
    const objectBody = match[1] ?? "";
    return !/\bstream\b/iu.test(objectBody) && /\/Type\s+\/Page(?:\s|\/|>)/u.test(objectBody);
  }).length;
  return pages > 0 ? pages : null;
}

interface ZipEntry {
  readonly name: string;
  readonly content: Uint8Array;
}

function hasPrefix(content: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((byte, index) => content[index] === byte);
}

function hasZipSignature(content: Uint8Array): boolean {
  return (
    hasPrefix(content, [0x50, 0x4b, 0x03, 0x04]) ||
    hasPrefix(content, [0x50, 0x4b, 0x05, 0x06]) ||
    hasPrefix(content, [0x50, 0x4b, 0x07, 0x08])
  );
}

function readZipEntries(content: Uint8Array): readonly ZipEntry[] {
  if (!hasZipSignature(content)) return [];
  const view = new DataView(content.buffer, content.byteOffset, content.byteLength);
  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  let offset = 0;
  while (offset + 30 <= content.byteLength) {
    if (view.getUint32(offset, true) !== 0x04034b50) break;
    const compressionMethod = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > content.byteLength || dataStart < nameStart) return [];
    const name = decoder.decode(content.subarray(nameStart, dataStart - extraLength));
    const compressed = content.subarray(dataStart, dataEnd);
    let uncompressed: Uint8Array;
    if (compressionMethod === 0) {
      uncompressed = compressed;
    } else if (compressionMethod === 8) {
      try {
        uncompressed = new Uint8Array(inflateRawSync(compressed));
      } catch {
        return [];
      }
    } else {
      return [];
    }
    entries.push({ name, content: uncompressed });
    offset = dataEnd;
  }
  return entries;
}

function assertDeclaredFormat(content: Uint8Array, format: OutputFormat): void {
  const pdf = hasPrefix(content, [0x25, 0x50, 0x44, 0x46, 0x2d]);
  const zip = hasZipSignature(content);
  if (format === "pdf" && !pdf) {
    throw new Error("rendered PDF content must start with the PDF signature");
  }
  if (format === "docx") {
    const entries = readZipEntries(content);
    if (
      !zip ||
      entries.length === 0 ||
      !entries.some((entry) => entry.name === "word/document.xml")
    ) {
      throw new Error("rendered DOCX content must be a ZIP containing word/document.xml");
    }
  }
  if (format === "markdown" && (pdf || zip)) {
    throw new Error("rendered Markdown content must not start with a PDF or ZIP signature");
  }
}

function stripPdfLiteralContent(value: string): string {
  let output = "";
  let literalDepth = 0;
  let escaped = false;
  let hexLiteral = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? "";
    const next = value[index + 1] ?? "";
    if (literalDepth > 0) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === "(") {
        literalDepth += 1;
      } else if (character === ")") {
        literalDepth -= 1;
      }
      continue;
    }
    if (hexLiteral) {
      if (character === ">") hexLiteral = false;
      continue;
    }
    if (character === "(") {
      literalDepth = 1;
      continue;
    }
    if (character === "<" && next !== "<" && value[index - 1] !== "<") {
      hexLiteral = true;
      continue;
    }
    output += character;
  }
  return output.replace(/%[^\r\n]*/gu, "");
}

function detectActiveContent(
  content: Uint8Array,
  format: OutputFormat,
): {
  readonly detected: boolean;
  readonly signatures: readonly (typeof renderingQaActiveContentSignatures)[number][];
} {
  const raw = new TextDecoder().decode(content);
  const detectedSignatures = new Set<(typeof renderingQaActiveContentSignatures)[number]>();
  if (format === "markdown") {
    const checks: Readonly<
      Record<"html-event-handler" | "html-iframe" | "html-javascript-url" | "html-script", RegExp>
    > = {
      "html-event-handler": /<[^>]+\s+on[a-z][a-z0-9_-]*\s*=/iu,
      "html-iframe": /<iframe\b/iu,
      "html-javascript-url":
        /(?:<[^>]+\s+(?:href|src)\s*=\s*["']?\s*(?:javascript\s*:|data\s*:\s*text\/html)|\]\(\s*(?:javascript\s*:|data\s*:\s*text\/html))/iu,
      "html-script": /<script\b/iu,
    };
    for (const signature of Object.keys(checks) as (keyof typeof checks)[]) {
      if (checks[signature].test(raw)) detectedSignatures.add(signature);
    }
  } else if (format === "pdf") {
    const structuralObjects = [...raw.matchAll(/\b\d+\s+0\s+obj\s+([\s\S]*?)\bendobj\b/gu)]
      .map((match) => match[1] ?? "")
      .filter((objectBody) => !/\bstream\b/iu.test(objectBody))
      .map(stripPdfLiteralContent)
      .join("\n");
    const checks: Readonly<
      Record<
        "pdf-additional-action" | "pdf-javascript" | "pdf-launch-action" | "pdf-open-action",
        RegExp
      >
    > = {
      "pdf-additional-action": /\/AA(?:\s|\/|>)/u,
      "pdf-javascript": /\/(?:JavaScript|JS)(?:\s|\/|>)/u,
      "pdf-launch-action": /\/Launch(?:\s|\/|>)/u,
      "pdf-open-action": /\/OpenAction(?:\s|\/|>)/u,
    };
    for (const signature of Object.keys(checks) as (keyof typeof checks)[]) {
      if (checks[signature].test(structuralObjects)) detectedSignatures.add(signature);
    }
  } else {
    const entries = readZipEntries(content);
    const relationshipXml = entries
      .filter((entry) => entry.name.toLowerCase().endsWith(".rels"))
      .map((entry) => new TextDecoder().decode(entry.content));
    if (
      relationshipXml.some((xml) =>
        /\b(?:Type|Target)\s*=\s*["'][^"']*attachedTemplate[^"']*["']/iu.test(xml),
      )
    ) {
      detectedSignatures.add("docx-attached-template");
    }
    if (relationshipXml.some((xml) => /\bTargetMode\s*=\s*["']External["']/iu.test(xml))) {
      detectedSignatures.add("docx-external-link");
    }
    const xmlEntries = entries
      .filter((entry) => entry.name.toLowerCase().endsWith(".xml"))
      .map((entry) => new TextDecoder().decode(entry.content));
    if (
      entries.some((entry) => /(?:^|\/)(?:embeddings|objects)\//iu.test(entry.name)) ||
      xmlEntries.some((xml) => /<(?:[A-Za-z_][\w.-]*:)?(?:object|oleObject|embedded)\b/iu.test(xml))
    ) {
      detectedSignatures.add("docx-embedded-object");
    }
    if (
      entries.some((entry) => /(?:^|\/)vbaProject\.bin$/iu.test(entry.name)) ||
      entries.some(
        (entry) =>
          entry.name === "[Content_Types].xml" &&
          /macroEnabled/iu.test(new TextDecoder().decode(entry.content)),
      )
    ) {
      detectedSignatures.add("docx-macro-project");
    }
  }
  const signatures = renderingQaActiveContentSignatures.filter((signature) =>
    detectedSignatures.has(signature),
  );
  return { detected: signatures.length > 0, signatures };
}

function assertRenderingQaInputKeys(input: BuildRenderingQaReportInput): void {
  const allowedKeys = new Set(["artifact", "rendered", "createdAt", "viewerObservation"]);
  for (const key of Object.keys(input as object)) {
    if (!allowedKeys.has(key)) {
      throw new TypeError(`Unknown rendering QA input field: ${key}`);
    }
  }
}

function viewerObservationPassed(
  observation: RenderingQaViewerObservation,
  expectedChecksum: string,
  expectedCount: number,
  targetPageCount: number,
): boolean {
  return (
    observation.recoveredVisibleContentChecksum === expectedChecksum &&
    observation.recoveredVisibleContentCount === expectedCount &&
    observation.recoveredVisibleContentOrder === "preserved" &&
    observation.pageCount <= targetPageCount &&
    observation.blankPageNumbers.length === 0 &&
    observation.overflowPageNumbers.length === 0 &&
    observation.orphanSectionIds.length === 0 &&
    !observation.clippedText
  );
}

export interface BuildRenderingQaReportInput {
  readonly artifact: DraftArtifact;
  readonly rendered: RenderedDocument;
  readonly createdAt: string;
  readonly viewerObservation?: RenderingQaViewerObservation;
}

export type BuiltRenderingQaReport = RenderingQaReport;

/**
 * Assemble a strict, immutable, content-free rendering QA report.
 *
 * The renderer's extraction is deterministic integrity evidence only. PDF and
 * DOCX reports remain incomplete until a caller supplies an independent viewer
 * observation; that observation is bound to the rendered checksum.
 */
export function buildRenderingQaReport(input: BuildRenderingQaReportInput): BuiltRenderingQaReport {
  assertRenderingQaInputKeys(input);
  const artifact = draftArtifactSchema.parse(input.artifact);
  if (!(input.rendered.content instanceof Uint8Array)) {
    throw new TypeError("rendered.content must be a Uint8Array");
  }
  const renderedMetadata = renderingQaRenderedMetadataSchema.parse(input.rendered.metadata);
  const contentChecksum = createHash("sha256").update(input.rendered.content).digest("hex");
  if (contentChecksum !== renderedMetadata.checksum) {
    throw new Error("rendered metadata checksum does not match rendered content");
  }
  if (
    renderedMetadata.artifactId !== artifact.id ||
    renderedMetadata.artifactVersion !== artifact.version
  ) {
    throw new Error("rendered metadata artifact identity does not match the artifact");
  }
  const sourceContentChecksum = computeArtifactContentChecksum(artifact);
  if (renderedMetadata.sourceContentChecksum !== sourceContentChecksum) {
    throw new Error("rendered metadata source content checksum does not match the artifact");
  }

  const viewerObservation =
    input.viewerObservation === undefined
      ? null
      : renderingQaViewerObservationSchema.parse(input.viewerObservation);
  if (
    input.rendered.extension !== extensionForFormat(renderedMetadata.format) ||
    (renderedMetadata.format === "markdown" &&
      input.rendered.mimeType !== "text/markdown; charset=utf-8") ||
    (renderedMetadata.format === "pdf" && input.rendered.mimeType !== "application/pdf") ||
    (renderedMetadata.format === "docx" &&
      input.rendered.mimeType !==
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
  ) {
    throw new Error("rendered extension or MIME type does not match its metadata format");
  }
  if (renderedMetadata.templateVersion !== renderTemplateVersion) {
    throw new Error("rendered metadata template version is not supported");
  }
  assertDeclaredFormat(input.rendered.content, renderedMetadata.format);
  if (viewerObservation !== null) {
    const artifactSectionIds = new Set(artifact.sections.map((section) => section.id));
    if (
      viewerObservation.orphanSectionIds.some((sectionId) => !artifactSectionIds.has(sectionId))
    ) {
      throw new Error("viewer observation contains an unknown orphan section id");
    }
  }

  const expectedUnits = expectedVisibleTextUnits(artifact, renderedMetadata.format);
  const recoveredUnits = extractVisibleTextUnits(input.rendered);
  const expectedSequence = normalizedSequence(expectedUnits);
  const recoveredSequence = normalizedSequence(recoveredUnits);
  const expectedChecksum = sha256Text(expectedSequence);
  const recoveredChecksum = sha256Text(recoveredSequence);
  const expectedCount = visibleWordCount(expectedSequence);
  const recoveredCount = visibleWordCount(recoveredSequence);
  const expectedHeadings = expectedUnits
    .filter((unit) => unit.kind === "heading")
    .map((unit) => normalizeVisibleText(unit.text));
  const recoveredHeadings = recoveredUnits
    .filter((unit) => unit.kind === "heading")
    .map((unit) => normalizeVisibleText(unit.text));
  const expectedBody = normalizedSequence(expectedUnits.filter((unit) => unit.kind === "body"));
  const recoveredBody = normalizedSequence(recoveredUnits.filter((unit) => unit.kind === "body"));
  const sectionOrderMatches =
    expectedHeadings.length === recoveredHeadings.length &&
    expectedHeadings.every((heading, index) => heading === recoveredHeadings[index]);
  const blockOrderMatches = expectedBody === recoveredBody;
  const duplicateContentPreserved = blockOrderMatches;
  const punctuationPreserved = blockOrderMatches;
  const contentIntegrity = {
    expectedVisibleContentChecksum: expectedChecksum,
    recoveredVisibleContentChecksum: recoveredChecksum,
    expectedVisibleContentCount: expectedCount,
    recoveredVisibleContentCount: recoveredCount,
    visibleContentMatches:
      expectedChecksum === recoveredChecksum && expectedCount === recoveredCount,
    sectionOrderMatches,
    blockOrderMatches,
    duplicateContentPreserved,
    punctuationPreserved,
  };

  const activeContent = detectActiveContent(input.rendered.content, renderedMetadata.format);
  const deterministicPageCount =
    renderedMetadata.format === "pdf" ? inspectPdfPageCount(input.rendered.content) : null;
  const targetPageCount = renderingMetadataTargetPageCount(renderedMetadata.layoutProfile);
  const pageTargetPassed =
    renderedMetadata.format !== "pdf" ||
    (deterministicPageCount !== null && deterministicPageCount <= targetPageCount);
  const deterministicPassed =
    contentIntegrity.visibleContentMatches &&
    contentIntegrity.sectionOrderMatches &&
    contentIntegrity.blockOrderMatches &&
    contentIntegrity.duplicateContentPreserved &&
    contentIntegrity.punctuationPreserved &&
    !activeContent.detected &&
    pageTargetPassed;
  const complete = renderedMetadata.format === "markdown" || viewerObservation !== null;
  const passed =
    deterministicPassed &&
    complete &&
    (viewerObservation === null
      ? renderedMetadata.format === "markdown"
      : viewerObservationPassed(
          viewerObservation,
          expectedChecksum,
          expectedCount,
          targetPageCount,
        ));

  const limitations = [
    ...(renderedMetadata.format === "pdf" && deterministicPageCount !== null
      ? []
      : ["deterministic-page-count-not-assessed" as const]),
    ...(viewerObservation === null && renderedMetadata.format !== "markdown"
      ? ["independent-viewer-observation-not-run" as const]
      : []),
    "structured-images-unsupported" as const,
    "structured-links-unsupported" as const,
  ].sort((left, right) => renderingQaLimitationOrder(left) - renderingQaLimitationOrder(right));

  const report = renderingQaReportSchema.parse({
    schemaVersion: 1,
    artifact: { id: artifact.id, version: artifact.version },
    rendered: renderedMetadata,
    createdAt: input.createdAt,
    contentIntegrity,
    activeContent,
    targetPageCount,
    deterministicPageCount,
    viewerObservation,
    limitations,
    deterministicPassed,
    complete,
    passed,
  });
  return deepFreeze(report);
}

function renderingMetadataTargetPageCount(profileId: RenderingLayoutProfileId): 1 | 2 {
  return getRenderingLayoutProfile(profileId).targetMaxPages;
}

function renderingQaLimitationOrder(
  limitation: (typeof renderingQaLimitationCodes)[number],
): number {
  return renderingQaLimitationCodes.indexOf(limitation);
}

export function renderArtifact(
  artifact: DraftArtifact,
  format: OutputFormat,
  options: RenderOptions = {},
): RenderedDocument {
  if (!outputFormats.includes(format)) {
    throw new RangeError(`Unsupported output format: ${format}`);
  }
  assertCanonicalOptionKeys(options);
  const profile = getRenderingLayoutProfile(options.layoutProfile);
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const effectiveOptions: RenderOptions = { ...options, generatedAt };
  assertExportable(artifact, effectiveOptions);
  const content = bytesForFormat(artifact, format, effectiveOptions);
  const checksum = createHash("sha256").update(content).digest("hex");
  const metadata: RenderMetadata = {
    artifactId: artifact.id,
    artifactVersion: artifact.version,
    format,
    generatedAt,
    templateVersion: renderTemplateVersion,
    layoutProfile: profile.id,
    checksum,
    sourceContentChecksum: computeArtifactContentChecksum(artifact),
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

export * from "./controlled-document-inspector.js";
