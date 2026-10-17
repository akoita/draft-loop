import { inflateSync } from "node:zlib";
import type { DraftArtifact } from "@draft-loop/schemas";
import type { RenderingTemplate } from "@draft-loop/schemas/rendering-template";

import { carlitoBold, carlitoRegular } from "./carlito-font-data.js";
import { isTitleBlockSection } from "./document-layout.js";
import { splitInlineLabel } from "./inline-label.js";
import { embeddedFontFlateBytes } from "./pdf-fonts.js";
import { isRoleHeaderBlock, splitRoleHeader } from "./role-header.js";
import { getRenderingTemplate } from "./templates.js";
import type { EmbeddedFontData } from "./truetype-font.js";

/*
 * Print-quality HTML (#1362): one self-contained A4 document that a browser engine prints straight
 * to PDF. The browser does the typesetting (kerning, wrapping, hanging indents), which our own PDF
 * writer cannot match. The fonts are embedded, so the result does not depend on what is installed.
 *
 * Every visible block carries `data-dl-unit` ("heading" or "body") and its text content is exactly
 * the artifact block's text, so the engine that printed it can report back what it drew and
 * rendering QA can compare that with the artifact. A bullet is a real "•" in a fixed-width box with a
 * hanging indent, so it extracts as text like a hand-made CV; QA ignores a leading bullet glyph.
 * There is no letter-spacing or case transform, which can break CV parsers.
 */

/** The attribute naming a visible text unit and whether it is a heading or body text. */
export const printUnitAttribute = "data-dl-unit";

/** One visible block as the printing engine reports it: its kind and its text content. */
export interface PrintedTextUnit {
  readonly kind: "heading" | "body";
  readonly text: string;
}

/** What a browser engine returns after printing print HTML: the PDF and what it drew. */
export interface PrintedPdf {
  readonly pdf: Uint8Array;
  readonly units: readonly PrintedTextUnit[];
  readonly viewerName: string;
  readonly viewerVersion: string;
}

/** Prints print HTML to an A4 PDF; the desktop host provides one, the CLI does not. */
export type PdfPrinter = (html: string) => Promise<PrintedPdf>;

export interface PrintHtmlOptions {
  /** A built-in rendering template id; Classic when omitted. */
  readonly templateId?: string | undefined;
}

const fontFamily = "DraftLoop Carlito";
/** The navy of the person's own hand-made CVs, for the name and the section headings. */
const inkColor = "#1f3a5f";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const fontFaceCache = new Map<EmbeddedFontData, string>();

function fontFace(data: EmbeddedFontData, weight: 400 | 700): string {
  let base64 = fontFaceCache.get(data);
  if (base64 === undefined) {
    base64 = Buffer.from(inflateSync(embeddedFontFlateBytes(data))).toString("base64");
    fontFaceCache.set(data, base64);
  }
  return `@font-face{font-family:"${fontFamily}";font-style:normal;font-weight:${weight};src:url(data:font/ttf;base64,${base64}) format("truetype");}`;
}

function unit(tag: string, kind: "heading" | "body", className: string, inner: string): string {
  const classAttribute = className === "" ? "" : ` class="${className}"`;
  return `<${tag}${classAttribute} ${printUnitAttribute}="${kind}">${inner}</${tag}>`;
}

/** Text whose leading "Label:" is bold; the space after the colon stays in the text. */
function labelled(text: string): string {
  const parts = splitInlineLabel(text);
  return parts === null
    ? escapeHtml(text)
    : `<strong>${escapeHtml(parts.label)}</strong>${escapeHtml(parts.rest)}`;
}

/** A role header: bold, with the date range right-aligned; the separator stays for copy and paste. */
function roleHeader(text: string): string {
  const parts = splitRoleHeader(text);
  if (parts === null) return unit("p", "body", "role", escapeHtml(text));
  const inner = `<span class="role-title">${escapeHtml(parts.left)}</span><span class="separator"> | </span><span class="date">${escapeHtml(parts.date)}</span>`;
  return unit("p", "body", "role", inner);
}

function sectionHtml(section: DraftArtifact["sections"][number]): string {
  if (isTitleBlockSection(section)) {
    return `<header>${section.blocks
      .map((block, index) =>
        index === 0
          ? unit("h1", "heading", "name", escapeHtml(block.text))
          : unit("p", "body", "contact", escapeHtml(block.text)),
      )
      .join("")}</header>`;
  }
  const parts: string[] = [unit("h2", "heading", "", escapeHtml(section.title))];
  let bullets: string[] = [];
  const closeList = (): void => {
    if (bullets.length > 0) parts.push(`<ul>${bullets.join("")}</ul>`);
    bullets = [];
  };
  section.blocks.forEach((block, index) => {
    if (block.type === "bullet") {
      bullets.push(unit("li", "body", "", `<span class="bullet">• </span>${labelled(block.text)}`));
      return;
    }
    closeList();
    parts.push(
      isRoleHeaderBlock(section.kind, section.blocks, index)
        ? roleHeader(block.text)
        : unit("p", "body", "", labelled(block.text)),
    );
  });
  closeList();
  return `<section>${parts.join("")}</section>`;
}

function printCss(template: RenderingTemplate): string {
  const { page, fonts, spacing, headings, name } = template;
  const margins = page.marginsMm;
  const bulletIndent = fonts.bodyPt + 1;
  const rule = headings.rule ? `border-bottom:0.75pt solid ${headings.ruleColor};` : "";
  return [
    fontFace(carlitoRegular, 400),
    fontFace(carlitoBold, 700),
    `@page{size:A4;margin:${margins.top}mm ${margins.right}mm ${margins.bottom}mm ${margins.left}mm;}`,
    "*{box-sizing:border-box;}",
    "html{-webkit-print-color-adjust:exact;print-color-adjust:exact;}",
    `body{margin:0;color:#1e2932;font-family:"${fontFamily}",Calibri,sans-serif;font-size:${fonts.bodyPt}pt;line-height:${fonts.lineHeight};font-kerning:normal;text-rendering:optimizeLegibility;}`,
    `h1.name{margin:0 0 ${spacing.titleAfterPt}pt;font-size:${fonts.namePt}pt;line-height:1.15;font-weight:700;text-align:${name.align};color:${inkColor};}`,
    `p.contact{margin:0 0 ${spacing.contactAfterPt}pt;text-align:${name.align};color:#3b4852;}`,
    "header{margin-bottom:2pt;}",
    `h2{margin:${spacing.headingBeforePt}pt 0 ${spacing.headingAfterPt + 1}pt;padding-bottom:1.5pt;${rule}font-size:${fonts.headingPt}pt;line-height:1.2;font-weight:700;color:${inkColor};break-after:avoid;}`,
    `p{margin:0 0 ${spacing.blockAfterPt}pt;orphans:2;widows:2;}`,
    `p.role{display:flex;justify-content:space-between;align-items:baseline;gap:12pt;margin:${spacing.roleBeforePt}pt 0 1pt;font-weight:700;break-after:avoid;}`,
    "h2+p.role{margin-top:0;}",
    "p.role .separator{display:inline-block;width:0;overflow:hidden;white-space:pre;}",
    "p.role .date{flex:none;font-weight:400;white-space:nowrap;}",
    `ul{list-style:none;margin:0 0 ${spacing.blockAfterPt}pt;padding:0;}`,
    `li{margin:0 0 1.2pt;padding-left:${bulletIndent}pt;text-indent:-${bulletIndent}pt;break-inside:avoid;}`,
    `li .bullet{display:inline-block;width:${bulletIndent}pt;text-indent:0;white-space:pre;}`,
    "li:last-child{margin-bottom:0;}",
    "strong{font-weight:700;}",
  ].join("\n");
}

/** The print-ready HTML of an artifact, drawn with a built-in rendering template. */
export function renderPrintHtml(artifact: DraftArtifact, options: PrintHtmlOptions = {}): string {
  const template = getRenderingTemplate(options.templateId);
  const body = artifact.sections
    .slice()
    .sort((left, right) => left.order - right.order)
    .map(sectionHtml)
    .join("");
  const language = escapeHtml(artifact.language);
  const name = artifact.sections.find(isTitleBlockSection)?.blocks[0]?.text;
  const title = escapeHtml(name === undefined ? "CV" : `${name}, CV`);
  return `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><title>${title}</title><style>${printCss(template)}</style></head><body><main>${body}</main></body></html>`;
}
