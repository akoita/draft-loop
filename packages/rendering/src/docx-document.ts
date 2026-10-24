import type { DraftArtifact } from "@draft-loop/schemas";
import type { RenderingTemplate } from "@draft-loop/schemas/rendering-template";

import { docxCompactStyle } from "./compact-list.js";
import {
  contentWidthPt,
  type LayoutBlock,
  labelledLayout,
  layoutBlocks,
  layoutMetrics,
  roleHasSpaceBefore,
  roleHeaderLines,
} from "./document-layout.js";
import type { RenderingLayoutProfile } from "./index.js";

/**
 * The DOCX package for an approved artifact: one flowing body of ordinary paragraphs with named
 * styles, a real bullet list, an A4 page and the profile's margins. It deliberately has no tables,
 * text boxes, headers, footers, images, comments or fields, so an applicant tracking system reads
 * the text in order, and only the visible text of the artifact is in `word/document.xml`.
 */

const wordNamespace = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const xmlDeclaration = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`;
const twipsPerPoint = 20;
const twipsPerMillimeter = 56.6929134;
const bulletNumberingId = 1;

/**
 * What a template draws beyond its metrics (#1412), matching the desktop's print CSS: Modern's
 * left-aligned name, accent headings and dates, uppercase headings, justified body text, italic
 * context line and hanging labelled paragraphs. Classic and Compact set none of these, so their
 * DOCX is unchanged. Uppercase is the `caps` run property, so the text stays as written.
 */
interface DocxLook {
  readonly nameAlign: "center" | "left";
  /** Colours as six hex digits; null keeps Word's automatic colour. */
  readonly nameColor: string | null;
  readonly contactColor: string | null;
  readonly accentColor: string | null;
  readonly ruleColor: string | null;
  readonly headingCaps: boolean;
  readonly justify: boolean;
  readonly italicContext: boolean;
}

const hexColor = (color: string): string => color.replace(/^#/u, "").toUpperCase();

function docxLook(template: RenderingTemplate): DocxLook {
  const accent = template.accentColor === null ? null : hexColor(template.accentColor);
  return {
    nameAlign: template.name.align,
    // The print CSS's near-black name and grey contact line, used alongside an accent colour.
    nameColor: accent === null ? null : "1B2329",
    contactColor: accent === null ? null : "3B4852",
    accentColor: accent,
    ruleColor: template.headings.rule ? hexColor(template.headings.ruleColor) : null,
    headingCaps: template.headings.case === "uppercase",
    justify: template.body.align === "justify",
    italicContext: template.roles.contextStyle === "italic",
  };
}

const colorProperty = (color: string | null): string =>
  color === null ? "" : `<w:color w:val="${color}"/>`;

function escapeXml(value: string): string {
  // Apostrophes stay literal: both text nodes and the double-quoted attributes here allow them,
  // and the QA inspectors decode only the five predefined entities written by this module.
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function twips(points: number): number {
  return Math.round(points * twipsPerPoint);
}

function halfPoints(points: number): number {
  return Math.round(points * 2);
}

function paragraph(style: string, text: string, extraProperties = ""): string {
  return `<w:p><w:pPr><w:pStyle w:val="${style}"/>${extraProperties}</w:pPr><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

/** A paragraph whose label is a bold run and whose text after it is regular. */
function labelledParagraph(
  style: string,
  label: string,
  block: LayoutBlock,
  extraProperties = "",
): string {
  const rest = block.text.slice(block.text.indexOf(label) + label.length);
  return `<w:p><w:pPr><w:pStyle w:val="${style}"/>${extraProperties}</w:pPr>${boldRun(label)}<w:r><w:t xml:space="preserve">${escapeXml(rest)}</w:t></w:r></w:p>`;
}

const boldRun = (text: string): string =>
  `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;

/**
 * A role header: a bold run and, when the last " | " segment is a date range, a right tab stop at
 * the content edge and the dates after it. The tab is the only thing that stands for the " | ".
 */
function roleParagraph(
  block: LayoutBlock,
  profile: RenderingLayoutProfile,
  look: DocxLook,
  previous: LayoutBlock | undefined,
): string {
  const { date } = roleHeaderLines(block, profile);
  const tabStop =
    date === null
      ? ""
      : `<w:tabs><w:tab w:val="right" w:pos="${twips(contentWidthPt(profile))}"/></w:tabs>`;
  // The style carries the space before a role; the first one under a heading has none.
  const noSpace = roleHasSpaceBefore(previous) ? "" : `<w:spacing w:before="0"/>`;
  // An accent template draws the dates bold in its accent colour.
  const dateProperties =
    look.accentColor === null ? "" : `<w:rPr><w:b/>${colorProperty(look.accentColor)}</w:rPr>`;
  const runs =
    date === null
      ? boldRun(block.text)
      : `${boldRun(block.text.slice(0, block.text.lastIndexOf(" | ")).trim())}<w:r><w:tab/></w:r><w:r>${dateProperties}<w:t xml:space="preserve">${escapeXml(date)}</w:t></w:r>`;
  return `<w:p><w:pPr><w:pStyle w:val="Role"/>${tabStop}${noSpace}</w:pPr>${runs}</w:p>`;
}

function blockParagraph(
  block: LayoutBlock,
  profile: RenderingLayoutProfile,
  look: DocxLook,
  previous: LayoutBlock | undefined,
): string {
  // The paragraph right under a role header is its context line (as `isRoleContextLine` decides).
  const context = look.italicContext && block.kind === "paragraph" && previous?.kind === "role";
  const labelled = labelledLayout(block, profile);
  if (labelled !== null) {
    const numbering = `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${bulletNumberingId}"/></w:numPr>`;
    if (block.kind === "bullet") {
      return labelledParagraph("ListBullet", labelled.label, block, numbering);
    }
    const style = context ? "RoleContext" : look.justify ? "Labelled" : "Normal";
    return labelledParagraph(style, labelled.label, block);
  }
  if (context) return paragraph("RoleContext", block.text);
  switch (block.kind) {
    case "compact":
      return paragraph(docxCompactStyle, block.text);
    case "role":
      return roleParagraph(block, profile, look, previous);
    case "title":
      return paragraph("Title", block.text);
    case "contact":
      return paragraph("Contact", block.text);
    case "heading":
      return paragraph("Heading1", block.text);
    case "bullet":
      return paragraph(
        "ListBullet",
        block.text,
        `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${bulletNumberingId}"/></w:numPr>`,
      );
    default:
      return paragraph("Normal", block.text);
  }
}

function documentXml(
  artifact: DraftArtifact,
  profile: RenderingLayoutProfile,
  look: DocxLook,
): string {
  const { top, right, bottom, left } = profile.marginsMm;
  const margin = (millimeters: number): number => Math.round(millimeters * twipsPerMillimeter);
  const body = layoutBlocks(artifact, profile)
    .map((block, index, blocks) => blockParagraph(block, profile, look, blocks[index - 1]))
    .join("");
  return `${xmlDeclaration}<w:document xmlns:w="${wordNamespace}"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="${margin(top)}" w:right="${margin(right)}" w:bottom="${margin(bottom)}" w:left="${margin(left)}" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
}

function stylesXml(
  artifact: DraftArtifact,
  profile: RenderingLayoutProfile,
  look: DocxLook,
): string {
  const metrics = layoutMetrics(profile);
  const family = escapeXml(profile.typography.docxFontFamily);
  const font = `<w:rFonts w:ascii="${family}" w:hAnsi="${family}" w:eastAsia="${family}" w:cs="${family}"/>`;
  const bodySize = halfPoints(profile.typography.bodyFontSizePt);
  // Exact leading keeps Word's line height equal to the PDF's, whatever the font's natural height.
  const spacing = (
    beforePt: number,
    afterPt: number,
    linePt = profile.lineMetricsPt.body,
  ): string =>
    `<w:spacing w:before="${twips(beforePt)}" w:after="${twips(afterPt)}" w:line="${twips(linePt)}" w:lineRule="exact"/>`;
  // Justified body text ("both"); headings and role headers stay left so their tab and rule hold.
  const justify = look.justify ? `<w:pPr><w:jc w:val="both"/></w:pPr>` : "";
  const alignLeft = look.justify ? `<w:jc w:val="left"/>` : "";
  const contactRun =
    look.contactColor === null ? "" : `<w:rPr>${colorProperty(look.contactColor)}</w:rPr>`;
  const headingRule =
    look.ruleColor === null
      ? ""
      : `<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="${look.ruleColor}"/></w:pBdr>`;
  return `${xmlDeclaration}<w:styles xmlns:w="${wordNamespace}"><w:docDefaults><w:rPrDefault><w:rPr>${font}<w:sz w:val="${bodySize}"/><w:szCs w:val="${bodySize}"/><w:lang w:val="${escapeXml(artifact.language)}"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr>${spacing(0, metrics.blockAfterPt)}</w:pPr></w:pPrDefault></w:docDefaults>`.concat(
    `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/>${justify}</w:style>`,
    `<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Contact"/><w:qFormat/><w:pPr><w:keepNext/>${spacing(0, metrics.titleAfterPt, metrics.titleLinePt)}<w:jc w:val="${look.nameAlign}"/></w:pPr><w:rPr><w:b/>${colorProperty(look.nameColor)}<w:sz w:val="${halfPoints(metrics.titleSizePt)}"/><w:szCs w:val="${halfPoints(metrics.titleSizePt)}"/></w:rPr></w:style>`,
    `<w:style w:type="paragraph" w:styleId="Contact"><w:name w:val="Contact"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr>${spacing(0, metrics.contactAfterPt)}<w:jc w:val="${look.nameAlign}"/></w:pPr>${contactRun}</w:style>`,
    `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/>${headingRule}${spacing(metrics.headingBeforePt, metrics.headingAfterPt, profile.lineMetricsPt.heading)}${alignLeft}<w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/>${look.headingCaps ? "<w:caps/>" : ""}${colorProperty(look.accentColor)}<w:sz w:val="${halfPoints(profile.typography.headingFontSizePt)}"/><w:szCs w:val="${halfPoints(profile.typography.headingFontSizePt)}"/></w:rPr></w:style>`,
    `<w:style w:type="paragraph" w:styleId="Role"><w:name w:val="Role"/><w:basedOn w:val="Normal"/><w:next w:val="ListBullet"/><w:qFormat/><w:pPr><w:keepNext/>${spacing(metrics.roleBeforePt, metrics.blockAfterPt)}${alignLeft}</w:pPr></w:style>`,
    ...(look.italicContext
      ? [
          `<w:style w:type="paragraph" w:styleId="RoleContext"><w:name w:val="Role Context"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/>${spacing(0, 1)}</w:pPr><w:rPr><w:i/><w:color w:val="4A5560"/></w:rPr></w:style>`,
        ]
      : []),
    // A justified template also hangs a labelled paragraph's later lines under its label.
    ...(look.justify
      ? [
          `<w:style w:type="paragraph" w:styleId="Labelled"><w:name w:val="Labelled"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr>${spacing(0, metrics.blockAfterPt + 1)}<w:ind w:left="${twips(metrics.bulletIndentPt)}" w:hanging="${twips(metrics.bulletIndentPt)}"/></w:pPr></w:style>`,
        ]
      : []),
    `<w:style w:type="paragraph" w:styleId="${docxCompactStyle}"><w:name w:val="Compact List"/><w:basedOn w:val="Normal"/><w:qFormat/></w:style>`,
    `<w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:numPr><w:numId w:val="${bulletNumberingId}"/></w:numPr><w:ind w:left="${twips(metrics.bulletIndentPt)}" w:hanging="${twips(metrics.bulletIndentPt)}"/></w:pPr></w:style>`,
    `</w:styles>`,
  );
}

function numberingXml(profile: RenderingLayoutProfile): string {
  const indent = twips(layoutMetrics(profile).bulletIndentPt);
  return `${xmlDeclaration}<w:numbering xmlns:w="${wordNamespace}"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="&#8226;"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${indent}" w:hanging="${indent}"/></w:pPr><w:rPr><w:rFonts w:ascii="${escapeXml(profile.typography.docxFontFamily)}" w:hAnsi="${escapeXml(profile.typography.docxFontFamily)}" w:cs="${escapeXml(profile.typography.docxFontFamily)}" w:hint="default"/></w:rPr></w:lvl></w:abstractNum><w:num w:numId="${bulletNumberingId}"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;
}

function coreXml(title: string, createdAt: string): string {
  return `${xmlDeclaration}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/coreProperties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escapeXml(title)}</dc:title><dc:creator>DraftLoop</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${escapeXml(createdAt)}</dcterms:created></cp:coreProperties>`;
}

const contentTypesXml = `${xmlDeclaration}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;

const packageRelationshipsXml = `${xmlDeclaration}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;

const documentRelationshipsXml = `${xmlDeclaration}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>`;

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

/** A ZIP of stored (uncompressed) entries, which every OOXML reader accepts. */
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
    central.push(
      concatBytes(
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
      ),
    );
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

export interface DocxRenderInput {
  readonly artifact: DraftArtifact;
  readonly profile: RenderingLayoutProfile;
  /** The template whose look the document draws; its metrics are already in `profile`. */
  readonly template: RenderingTemplate;
  readonly documentTitle: string;
  readonly generatedAt: string;
}

export function buildDocx(input: DocxRenderInput): Uint8Array {
  const { artifact, profile } = input;
  const look = docxLook(input.template);
  return zipStored({
    "[Content_Types].xml": contentTypesXml,
    "_rels/.rels": packageRelationshipsXml,
    "word/_rels/document.xml.rels": documentRelationshipsXml,
    "word/document.xml": documentXml(artifact, profile, look),
    "word/styles.xml": stylesXml(artifact, profile, look),
    "word/numbering.xml": numberingXml(profile),
    "docProps/core.xml": coreXml(input.documentTitle, input.generatedAt),
  });
}
