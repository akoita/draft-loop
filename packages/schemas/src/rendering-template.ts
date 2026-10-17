import { z } from "zod";

/*
 * A rendering template (#1328): the visual settings of a CV as bounded data. The renderer derives its
 * layout profile from a template, so a template never carries layout code, only settings.
 *
 * Every value is bounded and every enum accepts only what the renderer draws today. Modern (#1329)
 * widened them with a left-aligned name, uppercase headings, an accent colour, justified body text
 * and an italic role context line. The bounds hold every built-in with room to spare.
 */

export const renderingTemplateSchemaVersion = 1;

/** Content width the margins must leave on the 210 mm A4 page. */
export const renderingTemplateMinimumContentWidthMm = 120;
const a4PageWidthMm = 210;

const marginMm = z.number().min(8).max(25);
const bodyPt = z.number().min(8).max(11);
const headingPt = z.number().min(9.5).max(14);
const namePt = z.number().min(14).max(24);
const lineHeight = z.number().min(1.1).max(1.5);
const spacingPt = z.number().min(0).max(12);
const hexColour = (name: string) =>
  z.string().regex(/^#[0-9a-fA-F]{6}$/u, `${name} must be a #rrggbb hex colour`);

export const renderingTemplateSchema = z
  .strictObject({
    schemaVersion: z.literal(renderingTemplateSchemaVersion),
    id: z
      .string()
      .min(1)
      .max(40)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, "id must be a lowercase slug"),
    version: z.number().int().positive().max(1_000_000),
    displayName: z.string().trim().min(1).max(60),
    description: z.string().trim().min(1).max(300),
    page: z.strictObject({
      size: z.literal("A4"),
      marginsMm: z.strictObject({
        top: marginMm,
        right: marginMm,
        bottom: marginMm,
        left: marginMm,
      }),
      targetPages: z.union([z.literal(1), z.literal(2)]),
    }),
    fonts: z.strictObject({
      family: z.literal("sans"),
      bodyPt,
      headingPt,
      namePt,
      lineHeight,
    }),
    spacing: z.strictObject({
      headingBeforePt: spacingPt,
      headingAfterPt: spacingPt,
      blockAfterPt: spacingPt,
      roleBeforePt: spacingPt,
      titleAfterPt: spacingPt,
      contactAfterPt: spacingPt,
    }),
    name: z.strictObject({ align: z.enum(["center", "left"]) }),
    headings: z.strictObject({
      case: z.enum(["as-written", "uppercase"]),
      rule: z.boolean(),
      ruleColor: hexColour("ruleColor"),
    }),
    body: z.strictObject({ align: z.enum(["left", "justify"]) }),
    roles: z.strictObject({ contextStyle: z.enum(["regular", "italic"]) }),
    skills: z.strictObject({ style: z.literal("as-written") }),
    /** Colours the section headings and role dates; null keeps the default navy ink. */
    accentColor: hexColour("accentColor").nullable(),
  })
  .superRefine((template, context) => {
    if (template.fonts.headingPt < template.fonts.bodyPt) {
      context.addIssue({
        code: "custom",
        path: ["fonts", "headingPt"],
        message: "heading size must be at least the body size",
      });
    }
    if (template.fonts.namePt < template.fonts.headingPt) {
      context.addIssue({
        code: "custom",
        path: ["fonts", "namePt"],
        message: "name size must be at least the heading size",
      });
    }
    const { left, right } = template.page.marginsMm;
    if (a4PageWidthMm - left - right < renderingTemplateMinimumContentWidthMm) {
      context.addIssue({
        code: "custom",
        path: ["page", "marginsMm"],
        message: `margins must leave at least ${renderingTemplateMinimumContentWidthMm} mm of content width`,
      });
    }
  });

export type RenderingTemplate = z.infer<typeof renderingTemplateSchema>;
