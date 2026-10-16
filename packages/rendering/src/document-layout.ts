import type { DraftArtifact } from "@draft-loop/schemas";

import { embeddedPdfFonts, embeddedTextUnits, type PdfFontFamily } from "./pdf-fonts.js";

/**
 * One laid-out unit of a controlled DOCX or PDF. Both formats are built from this single model so
 * they show the same headline, contact lines, headings and bullets, and so the length estimate
 * measures what the formats draw.
 */
export type LayoutBlockKind = "title" | "contact" | "heading" | "paragraph" | "bullet";

export interface LayoutBlock {
  readonly kind: LayoutBlockKind;
  readonly text: string;
}

/** The page measurements the layout and the length estimate need; a subset of a layout profile. */
export interface LayoutMetricsProfile {
  readonly pageWidthMm: number;
  readonly pageHeightMm: number;
  readonly marginsMm: {
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
    readonly left: number;
  };
  readonly typography: {
    readonly bodyFontSizePt: number;
    readonly headingFontSizePt: number;
    /** The PDF font the layout measures with; Helvetica when left out. */
    readonly pdfFont?: PdfFontFamily | undefined;
  };
  readonly lineMetricsPt: { readonly body: number; readonly heading: number };
  /** Spacing overrides; any field left out keeps the default of the original standard layout. */
  readonly spacingPt?: Partial<LayoutMetrics> | undefined;
}

/** Writing-policy page targets; kept structural so the layout stays framework-free. */
export type LengthPageTarget = "one-page" | "two-page";

const pageTargetCount: Readonly<Record<LengthPageTarget, number>> = {
  "one-page": 1,
  "two-page": 2,
};

/** Share of the target the estimate may exceed before it warns; the estimate is not exact. */
const clearOverflowRatio = 1.05;
const pointsPerMillimeter = 72 / 25.4;

function sectionsInOrder(artifact: DraftArtifact): readonly DraftArtifact["sections"][number][] {
  return artifact.sections.slice().sort((left, right) => left.order - right.order);
}

/**
 * The visible blocks of an artifact, in section order. A header section is the candidate's
 * headline and contact lines, so it draws without a section heading: its first block is the
 * title and the rest are contact lines. Nothing else about the artifact (ids, source references,
 * findings, comments) is carried into a block.
 */
export function layoutBlocks(artifact: DraftArtifact): readonly LayoutBlock[] {
  const blocks: LayoutBlock[] = [];
  for (const section of sectionsInOrder(artifact)) {
    if (section.kind === "header") {
      section.blocks.forEach((block, index) => {
        blocks.push({ kind: index === 0 ? "title" : "contact", text: block.text });
      });
      continue;
    }
    blocks.push({ kind: "heading", text: section.title });
    for (const block of section.blocks) {
      blocks.push({ kind: block.type === "bullet" ? "bullet" : "paragraph", text: block.text });
    }
  }
  return blocks;
}

/** Whether a section is drawn as the title block rather than under a heading. */
export function isTitleBlockSection(section: DraftArtifact["sections"][number]): boolean {
  return section.kind === "header";
}

// Helvetica advance widths per 1000 em for ASCII 32..126, used only to centre and to indent.
const helveticaWidths = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667,
  611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500,
  222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
] as const;
const boldWidthRatio = 1.06;

/**
 * Advance width of a text run in points. Helvetica estimates non-ASCII characters with an
 * average width; an embedded font measures every WinAnsi character with its real advance width.
 */
export function textWidthPt(
  text: string,
  sizePt: number,
  bold: boolean,
  font: PdfFontFamily = "helvetica",
): number {
  const embedded = embeddedPdfFonts(font);
  if (embedded !== null) {
    return (embeddedTextUnits(text, bold ? embedded.bold : embedded.regular) / 1000) * sizePt;
  }
  let units = 0;
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    units += code >= 32 && code <= 126 ? (helveticaWidths[code - 32] ?? 556) : 556;
  }
  return (units / 1000) * sizePt * (bold ? boldWidthRatio : 1);
}

/** The PDF font a layout profile measures and draws with. */
export function profilePdfFont(profile: LayoutMetricsProfile): PdfFontFamily {
  return profile.typography.pdfFont ?? "helvetica";
}

/**
 * Greedy word wrap to a real width, using the font's glyph widths. A single word wider than the
 * line stays on its own line rather than being split.
 */
export function wrapTextToWidth(
  text: string,
  widthPt: number,
  sizePt: number,
  bold = false,
  maxCharacters = Number.POSITIVE_INFINITY,
  font: PdfFontFamily = "helvetica",
): readonly string[] {
  const words = text.split(/\s+/u).filter((word) => word !== "");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line === "" ? word : `${line} ${word}`;
    if (
      line !== "" &&
      (textWidthPt(candidate, sizePt, bold, font) > widthPt || candidate.length > maxCharacters)
    ) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line !== "") lines.push(line);
  return lines.length === 0 ? [""] : lines;
}

/** Point sizes and spacing shared by the PDF drawing and the length estimate. */
export interface LayoutMetrics {
  readonly titleSizePt: number;
  readonly titleLinePt: number;
  readonly headingBeforePt: number;
  readonly headingAfterPt: number;
  readonly blockAfterPt: number;
  readonly titleAfterPt: number;
  readonly contactAfterPt: number;
  readonly bulletIndentPt: number;
}

export function layoutMetrics(profile: LayoutMetricsProfile): LayoutMetrics {
  return {
    titleSizePt: profile.typography.headingFontSizePt + 5,
    titleLinePt: profile.lineMetricsPt.heading + 5,
    headingBeforePt: 8,
    headingAfterPt: 4,
    blockAfterPt: 3,
    titleAfterPt: 2,
    contactAfterPt: 0,
    bulletIndentPt: 14,
    ...profile.spacingPt,
  };
}

/** The width between the left and right margins, in points. */
export function contentWidthPt(profile: LayoutMetricsProfile): number {
  const widthMm = profile.pageWidthMm - profile.marginsMm.left - profile.marginsMm.right;
  return widthMm * pointsPerMillimeter;
}

/** Width the "• " prefix takes; bullet text on every line is indented by this much. */
export function bulletPrefixWidthPt(profile: LayoutMetricsProfile): number {
  return textWidthPt("• ", profile.typography.bodyFontSizePt, false, profilePdfFont(profile));
}

/**
 * Wrapped text lines for one block, filled to the real content width (less the bullet indent for
 * bullets) using the profile font's glyph widths.
 */
export function blockLines(block: LayoutBlock, profile: LayoutMetricsProfile): readonly string[] {
  const body = profile.typography.bodyFontSizePt;
  const indent = block.kind === "bullet" ? bulletPrefixWidthPt(profile) : 0;
  return wrapTextToWidth(
    block.text,
    contentWidthPt(profile) - indent,
    body,
    false,
    Number.POSITIVE_INFINITY,
    profilePdfFont(profile),
  );
}

/** The height one block takes, including its spacing, in points. */
export function blockHeightPt(block: LayoutBlock, profile: LayoutMetricsProfile): number {
  const metrics = layoutMetrics(profile);
  const lineCount = blockLines(block, profile).length;
  switch (block.kind) {
    case "title":
      return lineCount * metrics.titleLinePt + metrics.titleAfterPt;
    case "contact":
      return lineCount * profile.lineMetricsPt.body + metrics.contactAfterPt;
    case "heading":
      return (
        metrics.headingBeforePt + lineCount * profile.lineMetricsPt.heading + metrics.headingAfterPt
      );
    default:
      return lineCount * profile.lineMetricsPt.body + metrics.blockAfterPt;
  }
}

export interface LengthEstimate {
  readonly words: number;
  readonly lines: number;
  /** Estimated pages, rounded to one decimal. */
  readonly estimatedPages: number;
  /** The writing policy's page target, or null when it has none. */
  readonly targetPages: number | null;
  /** True only when the estimate clearly exceeds a target that exists. */
  readonly exceedsTarget: boolean;
  /** A one-sentence statement of the estimate that always says it is an estimate. */
  readonly summary: string;
  /** Present only when the estimate clearly exceeds the target. */
  readonly warning?: string;
}

export interface EstimateLengthOptions {
  readonly pageTarget?: LengthPageTarget | undefined;
}

function wordsIn(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/u).length;
}

/**
 * Estimate how long the rendered document is from line and word counts. Exact pagination depends
 * on the viewer's fonts and cannot be verified here, so the result is only ever worded as an
 * estimate, and it warns only when the content clearly exceeds a page target the policy sets.
 */
export function estimateDocumentLength(
  artifact: DraftArtifact,
  profile: LayoutMetricsProfile,
  options: EstimateLengthOptions = {},
): LengthEstimate {
  const blocks = layoutBlocks(artifact);
  const usedPt = blocks.reduce((total, block) => total + blockHeightPt(block, profile), 0);
  const lines = blocks.reduce((total, block) => total + blockLines(block, profile).length, 0);
  const words = blocks.reduce((total, block) => total + wordsIn(block.text), 0);
  const availablePt =
    profile.pageHeightMm * pointsPerMillimeter -
    (profile.marginsMm.top + profile.marginsMm.bottom) * pointsPerMillimeter;
  const estimatedPages = Math.round((usedPt / availablePt) * 10) / 10;
  const targetPages = options.pageTarget === undefined ? null : pageTargetCount[options.pageTarget];
  const exceedsTarget =
    targetPages !== null && usedPt > availablePt * targetPages * clearOverflowRatio;
  const pageWord = estimatedPages === 1 ? "page" : "pages";
  const basis = `${lines} lines and ${words} words`;
  const summary =
    targetPages === null
      ? `Estimated length: about ${estimatedPages} ${pageWord} (an estimate from ${basis}; the writing policy sets no page target).`
      : `Estimated length: about ${estimatedPages} ${pageWord} against a ${targetPages}-page target (an estimate from ${basis}).`;
  const warning = exceedsTarget
    ? `Estimated length is about ${estimatedPages} pages, over the ${targetPages}-page target in the writing policy. This is an estimate from ${basis}; open the file to confirm the real page count.`
    : undefined;
  return {
    words,
    lines,
    estimatedPages,
    targetPages,
    exceedsTarget,
    summary,
    ...(warning === undefined ? {} : { warning }),
  };
}
