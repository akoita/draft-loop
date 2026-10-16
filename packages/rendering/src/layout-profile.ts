import type { RenderingLayoutProfileId } from "@draft-loop/schemas";
import type { RenderingTemplate } from "@draft-loop/schemas/rendering-template";

import type { LayoutMetrics } from "./document-layout.js";
import type { PdfFontFamily } from "./pdf-fonts.js";
import {
  builtInRenderingTemplates,
  defaultRenderingTemplateId,
  getRenderingTemplate,
} from "./templates.js";

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
    /** The font the DOCX names. */
    readonly docxFontFamily: string;
    /** The font the PDF draws and the layout measures: embedded Carlito, or standard Helvetica. */
    readonly pdfFont: PdfFontFamily;
    readonly bodyFontSizePt: number;
    readonly headingFontSizePt: number;
    readonly lineHeight: number;
  };
  readonly lineMetricsPt: {
    readonly body: number;
    readonly heading: number;
  };
  /** Title, block and bullet spacing shared by the PDF, the DOCX and the length estimate. */
  readonly spacingPt: LayoutMetrics;
  /** Spacing of the HTML preview, which uses CSS rather than the shared block model. */
  readonly previewSpacingPt: {
    readonly headingBefore: number;
    readonly headingAfter: number;
    readonly blockAfter: number;
    readonly roleBefore: number;
    readonly listIndent: number;
  };
  readonly wrapping: {
    readonly bodyMaxCharacters: number;
    readonly bulletMaxCharacters: number;
  };
  readonly targetMaxPages: 1 | 2;
}

/**
 * Renderer settings a template does not carry. The `sans` family has one fixed set per page target:
 * a two-page template draws embedded Carlito (Calibri in DOCX), a one-page template draws Helvetica
 * (Arial in DOCX). The title line height, heading line height and bullet indent sit with that set
 * because they were tuned together with it; the body line height is derived from the template.
 */
interface SansFamilyConstants {
  readonly fontFamily: string;
  readonly docxFontFamily: string;
  readonly pdfFont: PdfFontFamily;
  readonly titleLinePt: number;
  readonly headingLinePt: number;
  readonly bulletIndentPt: number;
  readonly previewSpacingPt: RenderingLayoutProfile["previewSpacingPt"];
  readonly wrapping: RenderingLayoutProfile["wrapping"];
}

const sansFamilyConstants: Readonly<Record<1 | 2, SansFamilyConstants>> = {
  1: {
    fontFamily: "Arial, sans-serif",
    docxFontFamily: "Arial",
    pdfFont: "helvetica",
    titleLinePt: 26,
    headingLinePt: 21,
    bulletIndentPt: 14,
    previewSpacingPt: {
      headingBefore: 9,
      headingAfter: 7,
      blockAfter: 5,
      roleBefore: 5,
      listIndent: 17,
    },
    wrapping: { bodyMaxCharacters: 96, bulletMaxCharacters: 90 },
  },
  2: {
    fontFamily: "Calibri, Arial, sans-serif",
    docxFontFamily: "Calibri",
    pdfFont: "carlito",
    titleLinePt: 20,
    headingLinePt: 14,
    bulletIndentPt: 11,
    previewSpacingPt: {
      headingBefore: 6,
      headingAfter: 3,
      blockAfter: 2,
      roleBefore: 6,
      listIndent: 11,
    },
    // Generous caps: the real Carlito line width (about 150 characters at 9 pt) always binds first.
    wrapping: { bodyMaxCharacters: 200, bulletMaxCharacters: 195 },
  },
};

/** The layout profile id each built-in template produces; the QA schema knows profiles by these ids. */
const layoutProfileIdByTemplateId: Readonly<Record<string, RenderingLayoutProfileId>> = {
  classic: "standard-two-page",
  compact: "compact-one-page",
};

/** The layout profile id a template renders with. Throws for a template without a known profile. */
export function layoutProfileIdForTemplate(template: RenderingTemplate): RenderingLayoutProfileId {
  const id = Object.hasOwn(layoutProfileIdByTemplateId, template.id)
    ? layoutProfileIdByTemplateId[template.id]
    : undefined;
  if (id === undefined) {
    throw new RangeError(`Rendering template has no layout profile: ${template.id}`);
  }
  return id;
}

/** Derive the layout profile every controlled output format shares from a template. */
export function profileFromTemplate(template: RenderingTemplate): RenderingLayoutProfile {
  const constants = sansFamilyConstants[template.page.targetPages];
  const { fonts, spacing } = template;
  return {
    id: layoutProfileIdForTemplate(template),
    pageWidthMm: 210,
    pageHeightMm: 297,
    marginsMm: { ...template.page.marginsMm },
    typography: {
      fontFamily: constants.fontFamily,
      docxFontFamily: constants.docxFontFamily,
      pdfFont: constants.pdfFont,
      bodyFontSizePt: fonts.bodyPt,
      headingFontSizePt: fonts.headingPt,
      lineHeight: fonts.lineHeight,
    },
    lineMetricsPt: {
      body: Math.round(fonts.bodyPt * fonts.lineHeight),
      heading: constants.headingLinePt,
    },
    spacingPt: {
      titleSizePt: fonts.namePt,
      titleLinePt: constants.titleLinePt,
      headingBeforePt: spacing.headingBeforePt,
      headingAfterPt: spacing.headingAfterPt,
      blockAfterPt: spacing.blockAfterPt,
      roleBeforePt: spacing.roleBeforePt,
      titleAfterPt: spacing.titleAfterPt,
      contactAfterPt: spacing.contactAfterPt,
      bulletIndentPt: constants.bulletIndentPt,
    },
    previewSpacingPt: { ...constants.previewSpacingPt },
    wrapping: { ...constants.wrapping },
    targetMaxPages: template.page.targetPages,
  };
}

export interface RenderingTemplateSelection {
  readonly templateId?: string | undefined;
  readonly layoutProfile?: string | undefined;
}

/**
 * The template a render uses. `templateId` selects it (classic by default); `layoutProfile` is the
 * older way to pick the same layout and must agree with the template when both are given.
 */
export function resolveRenderingTemplate(selection: RenderingTemplateSelection): RenderingTemplate {
  const { layoutProfile, templateId } = selection;
  if (layoutProfile !== undefined && !Object.hasOwn(renderingLayoutProfiles, layoutProfile)) {
    throw new RangeError(`Unknown rendering layout profile: ${layoutProfile}`);
  }
  if (templateId !== undefined) {
    const template = getRenderingTemplate(templateId);
    if (layoutProfile !== undefined && layoutProfileIdForTemplate(template) !== layoutProfile) {
      throw new RangeError(
        `Rendering template ${templateId} does not match layout profile ${layoutProfile}`,
      );
    }
    return template;
  }
  if (layoutProfile === undefined) return getRenderingTemplate(defaultRenderingTemplateId);
  const template = Object.values(builtInRenderingTemplates).find(
    (candidate) => layoutProfileIdForTemplate(candidate) === layoutProfile,
  );
  if (template === undefined) {
    throw new RangeError(`Unknown rendering layout profile: ${layoutProfile}`);
  }
  return template;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

const layoutProfileTable = Object.fromEntries(
  Object.values(builtInRenderingTemplates).map((template) => {
    const profile = profileFromTemplate(template);
    return [profile.id, profile];
  }),
) as Readonly<Record<RenderingLayoutProfileId, RenderingLayoutProfile>>;

/** Immutable profiles used by every controlled output format, derived from the built-in templates. */
export const renderingLayoutProfiles = deepFreeze(layoutProfileTable);
