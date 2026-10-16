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

/** The literal profiles from before they were derived from templates (#1328), copied verbatim. */
const literalCompactOnePage = {
  id: "compact-one-page",
  pageWidthMm: 210,
  pageHeightMm: 297,
  marginsMm: { top: 12, right: 12, bottom: 12, left: 12 },
  typography: {
    fontFamily: "Arial, sans-serif",
    docxFontFamily: "Arial",
    pdfFont: "helvetica",
    bodyFontSizePt: 9.5,
    headingFontSizePt: 13,
    lineHeight: 1.25,
  },
  lineMetricsPt: { body: 12, heading: 21 },
  spacingPt: {
    titleSizePt: 18,
    titleLinePt: 26,
    headingBeforePt: 8,
    headingAfterPt: 4,
    blockAfterPt: 3,
    roleBeforePt: 5,
    titleAfterPt: 2,
    contactAfterPt: 0,
    bulletIndentPt: 14,
  },
  previewSpacingPt: {
    headingBefore: 9,
    headingAfter: 7,
    blockAfter: 5,
    roleBefore: 5,
    listIndent: 17,
  },
  wrapping: { bodyMaxCharacters: 96, bulletMaxCharacters: 90 },
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
      expect(template.version).toBe(1);
    }
    expect(getRenderingTemplate(undefined).id).toBe("classic");
    expect(Object.isFrozen(getRenderingTemplate("compact"))).toBe(true);
  });

  it("derive layout profiles that equal the literal profiles they replaced", () => {
    expect(profileFromTemplate(getRenderingTemplate("classic"))).toEqual(literalStandardTwoPage);
    expect(profileFromTemplate(getRenderingTemplate("compact"))).toEqual(literalCompactOnePage);
    expect(renderingLayoutProfiles["standard-two-page"]).toEqual(literalStandardTwoPage);
    expect(renderingLayoutProfiles["compact-one-page"]).toEqual(literalCompactOnePage);
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
    expect(rendered.metadata.renderingTemplate).toEqual({ id: "compact", version: 1 });
    expect(rendered.metadata.layoutProfile).toBe("compact-one-page");
  });

  it("keeps accepting layoutProfile and records the matching template", () => {
    const rendered = renderArtifact(artifact, "markdown", {
      ...renderOptions,
      layoutProfile: "compact-one-page",
    });
    expect(rendered.metadata.renderingTemplate).toEqual({ id: "compact", version: 1 });
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
