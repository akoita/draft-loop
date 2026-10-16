import {
  type RenderingTemplate,
  renderingTemplateSchema,
} from "@draft-loop/schemas/rendering-template";

/*
 * The built-in rendering templates (#1328), as validated data. Classic is the default and reproduces
 * the two-page standard layout; Compact reproduces the one-page layout. Both are checked against the
 * template schema when this module loads, so a bad edit fails at import rather than at render time.
 */

const classicTemplate: RenderingTemplate = {
  schemaVersion: 1,
  id: "classic",
  version: 1,
  displayName: "Classic",
  description: "Two-page CV with a centred name, ruled headings and room for full role histories.",
  page: { size: "A4", marginsMm: { top: 10, right: 12, bottom: 10, left: 12 }, targetPages: 2 },
  fonts: { family: "sans", bodyPt: 9, headingPt: 10.5, namePt: 16, lineHeight: 1.2 },
  spacing: {
    headingBeforePt: 6,
    headingAfterPt: 2,
    blockAfterPt: 0,
    roleBeforePt: 6,
    titleAfterPt: 2,
    contactAfterPt: 0,
  },
  name: { align: "center" },
  headings: { case: "as-written", rule: true, ruleColor: "#94a3ad" },
  skills: { style: "as-written" },
  accentColor: null,
};

const compactTemplate: RenderingTemplate = {
  schemaVersion: 1,
  id: "compact",
  version: 1,
  displayName: "Compact",
  description: "One-page CV with larger type and looser spacing for short, focused applications.",
  page: { size: "A4", marginsMm: { top: 12, right: 12, bottom: 12, left: 12 }, targetPages: 1 },
  fonts: { family: "sans", bodyPt: 9.5, headingPt: 13, namePt: 18, lineHeight: 1.25 },
  spacing: {
    headingBeforePt: 8,
    headingAfterPt: 4,
    blockAfterPt: 3,
    roleBeforePt: 5,
    titleAfterPt: 2,
    contactAfterPt: 0,
  },
  name: { align: "center" },
  headings: { case: "as-written", rule: true, ruleColor: "#94a3ad" },
  skills: { style: "as-written" },
  accentColor: null,
};

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

export const defaultRenderingTemplateId = "classic";

/** The built-in templates, validated and immutable, keyed by template id. */
export const builtInRenderingTemplates: Readonly<Record<string, RenderingTemplate>> = deepFreeze({
  classic: renderingTemplateSchema.parse(classicTemplate),
  compact: renderingTemplateSchema.parse(compactTemplate),
});

/** The built-in template with this id, or the default when no id is given. Throws on an unknown id. */
export function getRenderingTemplate(id: string | undefined): RenderingTemplate {
  const selected = id ?? defaultRenderingTemplateId;
  const template = Object.hasOwn(builtInRenderingTemplates, selected)
    ? builtInRenderingTemplates[selected]
    : undefined;
  if (template === undefined) throw new RangeError(`Unknown rendering template: ${selected}`);
  return template;
}
