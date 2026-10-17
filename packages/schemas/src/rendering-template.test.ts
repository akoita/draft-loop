import { describe, expect, it } from "vitest";

import { renderingTemplateSchema } from "./rendering-template.js";

const valid = {
  schemaVersion: 1,
  id: "synthetic",
  version: 1,
  displayName: "Synthetic",
  description: "A synthetic template used by the schema tests.",
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
  body: { align: "left" },
  roles: { contextStyle: "regular" },
  skills: { style: "as-written" },
  accentColor: null,
};

function withChange(path: readonly string[], value: unknown): unknown {
  const copy = structuredClone(valid) as Record<string, unknown>;
  let target = copy;
  for (const key of path.slice(0, -1)) target = target[key] as Record<string, unknown>;
  target[path[path.length - 1] as string] = value;
  return copy;
}

describe("renderingTemplateSchema", () => {
  it("accepts a well-formed template", () => {
    expect(renderingTemplateSchema.safeParse(valid).success).toBe(true);
  });

  it.each([
    [["page", "marginsMm", "top"], 7.9],
    [["page", "marginsMm", "left"], 25.1],
    [["page", "targetPages"], 3],
    [["fonts", "bodyPt"], 7.5],
    [["fonts", "bodyPt"], 11.5],
    [["fonts", "headingPt"], 14.5],
    [["fonts", "namePt"], 25],
    [["fonts", "lineHeight"], 1.6],
    [["spacing", "blockAfterPt"], 13],
    [["spacing", "headingBeforePt"], -1],
    [["version"], 0],
    [["id"], "Not A Slug"],
    [["headings", "ruleColor"], "red"],
    [["schemaVersion"], 2],
    [["accentColor"], "teal"],
  ])("rejects out-of-bounds %j = %j", (path, value) => {
    expect(renderingTemplateSchema.safeParse(withChange(path, value)).success).toBe(false);
  });

  it.each([
    [["name", "align"], "right"],
    [["headings", "case"], "upper"],
    [["body", "align"], "center"],
    [["roles", "contextStyle"], "bold"],
    [["fonts", "family"], "serif"],
    [["skills", "style"], "grouped"],
    [["page", "size"], "Letter"],
  ])("rejects a value the renderer does not draw yet: %j = %j", (path, value) => {
    expect(renderingTemplateSchema.safeParse(withChange(path, value)).success).toBe(false);
  });

  it("accepts the Modern options: left name, uppercase headings, accent, justified text", () => {
    const modern = {
      ...valid,
      name: { align: "left" },
      headings: { ...valid.headings, case: "uppercase" },
      body: { align: "justify" },
      roles: { contextStyle: "italic" },
      accentColor: "#0f6e5c",
    };
    expect(renderingTemplateSchema.safeParse(modern).success).toBe(true);
  });

  it("rejects unknown keys", () => {
    expect(renderingTemplateSchema.safeParse({ ...valid, extra: true }).success).toBe(false);
  });

  it("rejects a heading smaller than the body", () => {
    const smaller = { ...valid, fonts: { ...valid.fonts, bodyPt: 10.5, headingPt: 10 } };
    const result = renderingTemplateSchema.safeParse(smaller);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("heading size must be at least the body size");
  });
});
