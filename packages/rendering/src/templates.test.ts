import { renderingTemplateSchema } from "@draft-loop/schemas/rendering-template";
import { describe, expect, it } from "vitest";

import {
  builtInRenderingTemplates,
  defaultRenderingTemplateId,
  getRenderingTemplate,
  profileFromTemplate,
  renderArtifact,
  renderingLayoutProfiles,
} from "./index.js";
import { fixtureGeneratedAt, syntheticCv } from "./synthetic-cv.fixture.js";

/** The literal profiles from before they were derived from templates (#1328); Compact made denser since. */
const literalCompactOnePage = {
  id: "compact-one-page",
  pageWidthMm: 210,
  pageHeightMm: 297,
  marginsMm: { top: 9, right: 10, bottom: 9, left: 10 },
  typography: {
    fontFamily: "Arial, sans-serif",
    docxFontFamily: "Arial",
    pdfFont: "helvetica",
    bodyFontSizePt: 8.5,
    headingFontSizePt: 10,
    lineHeight: 1.15,
  },
  lineMetricsPt: { body: 10, heading: 13 },
  spacingPt: {
    titleSizePt: 15,
    titleLinePt: 18,
    headingBeforePt: 4,
    headingAfterPt: 1,
    blockAfterPt: 0,
    roleBeforePt: 3,
    titleAfterPt: 1,
    contactAfterPt: 0,
    bulletIndentPt: 10,
  },
  previewSpacingPt: {
    headingBefore: 4,
    headingAfter: 2,
    blockAfter: 1,
    roleBefore: 3,
    listIndent: 10,
  },
  wrapping: { bodyMaxCharacters: 108, bulletMaxCharacters: 101 },
  targetMaxPages: 1,
};

const literalStandardTwoPage = {
  id: "standard-two-page",
  pageWidthMm: 210,
  pageHeightMm: 297,
  marginsMm: { top: 10, right: 12, bottom: 10, left: 12 },
  typography: {
    fontFamily: "Calibri, Arial, sans-serif",
    docxFontFamily: "Calibri",
    pdfFont: "carlito",
    bodyFontSizePt: 9,
    headingFontSizePt: 10.5,
    lineHeight: 1.2,
  },
  lineMetricsPt: { body: 11, heading: 14 },
  spacingPt: {
    titleSizePt: 16,
    titleLinePt: 20,
    headingBeforePt: 6,
    headingAfterPt: 2,
    blockAfterPt: 0,
    roleBeforePt: 6,
    titleAfterPt: 2,
    contactAfterPt: 0,
    bulletIndentPt: 11,
  },
  previewSpacingPt: {
    headingBefore: 6,
    headingAfter: 3,
    blockAfter: 2,
    roleBefore: 6,
    listIndent: 11,
  },
  wrapping: { bodyMaxCharacters: 200, bulletMaxCharacters: 195 },
  targetMaxPages: 2,
};

const renderOptions = { generatedAt: fixtureGeneratedAt, allowUnbackedClaims: true };

describe("built-in rendering templates", () => {
  it("are valid, versioned and classic is the default", () => {
    expect(defaultRenderingTemplateId).toBe("classic");
    expect(Object.keys(builtInRenderingTemplates)).toEqual(["classic", "compact"]);
    for (const template of Object.values(builtInRenderingTemplates)) {
      expect(renderingTemplateSchema.safeParse(template).success).toBe(true);
    }
    expect(getRenderingTemplate("classic").version).toBe(1);
    expect(getRenderingTemplate("compact").version).toBe(2);
    expect(getRenderingTemplate(undefined).id).toBe("classic");
    expect(Object.isFrozen(getRenderingTemplate("compact"))).toBe(true);
  });

  it("derive layout profiles that equal the literal profiles they replaced", () => {
    expect(profileFromTemplate(getRenderingTemplate("classic"))).toEqual(literalStandardTwoPage);
    expect(profileFromTemplate(getRenderingTemplate("compact"))).toEqual(literalCompactOnePage);
    expect(renderingLayoutProfiles["standard-two-page"]).toEqual(literalStandardTwoPage);
    expect(renderingLayoutProfiles["compact-one-page"]).toEqual(literalCompactOnePage);
  });

  it("makes Compact denser than Classic on every axis that sets page length", () => {
    const classic = getRenderingTemplate("classic");
    const compact = getRenderingTemplate("compact");
    expect(compact.fonts.bodyPt).toBeLessThan(classic.fonts.bodyPt);
    expect(compact.fonts.headingPt).toBeLessThan(classic.fonts.headingPt);
    expect(compact.fonts.lineHeight).toBeLessThan(classic.fonts.lineHeight);
    for (const side of ["top", "right", "bottom", "left"] as const) {
      expect(compact.page.marginsMm[side]).toBeLessThan(classic.page.marginsMm[side]);
    }
    for (const [key, value] of Object.entries(compact.spacing)) {
      expect(value).toBeLessThanOrEqual(classic.spacing[key as keyof typeof classic.spacing]);
    }
  });

  it("rejects an unknown template id, including inherited object keys", () => {
    expect(() => getRenderingTemplate("modern")).toThrow(/Unknown rendering template: modern/u);
    expect(() => getRenderingTemplate("constructor")).toThrow(RangeError);
  });
});

describe("renderArtifact template selection", () => {
  const artifact = syntheticCv(1);

  it("defaults to the classic template and its profile", () => {
    const rendered = renderArtifact(artifact, "pdf", renderOptions);
    expect(rendered.metadata.renderingTemplate).toEqual({ id: "classic", version: 1 });
    expect(rendered.metadata.layoutProfile).toBe("standard-two-page");
  });

  it("selects the compact profile with templateId", () => {
    const rendered = renderArtifact(artifact, "docx", { ...renderOptions, templateId: "compact" });
    expect(rendered.metadata.renderingTemplate).toEqual({ id: "compact", version: 2 });
    expect(rendered.metadata.layoutProfile).toBe("compact-one-page");
  });

  it("keeps accepting layoutProfile and records the matching template", () => {
    const rendered = renderArtifact(artifact, "markdown", {
      ...renderOptions,
      layoutProfile: "compact-one-page",
    });
    expect(rendered.metadata.renderingTemplate).toEqual({ id: "compact", version: 2 });
  });

  it("renders the same bytes whether the template or its profile is named", () => {
    const byTemplate = renderArtifact(artifact, "pdf", { ...renderOptions, templateId: "compact" });
    const byProfile = renderArtifact(artifact, "pdf", {
      ...renderOptions,
      layoutProfile: "compact-one-page",
    });
    expect(Buffer.from(byTemplate.content).equals(Buffer.from(byProfile.content))).toBe(true);
  });

  it("accepts a template and a layout profile that agree", () => {
    const rendered = renderArtifact(artifact, "markdown", {
      ...renderOptions,
      templateId: "classic",
      layoutProfile: "standard-two-page",
    });
    expect(rendered.metadata.renderingTemplate.id).toBe("classic");
  });

  it("throws when the template and layout profile disagree", () => {
    expect(() =>
      renderArtifact(artifact, "markdown", {
        ...renderOptions,
        templateId: "compact",
        layoutProfile: "standard-two-page",
      }),
    ).toThrow(/does not match layout profile/u);
  });

  it("throws on an unknown template id", () => {
    expect(() =>
      renderArtifact(artifact, "markdown", { ...renderOptions, templateId: "modern" }),
    ).toThrow(/Unknown rendering template: modern/u);
  });
});
