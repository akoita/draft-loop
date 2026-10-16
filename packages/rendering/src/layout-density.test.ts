import type { DraftArtifact } from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";

import { estimateDocumentLength } from "./document-layout.js";
import {
  buildRenderingQaReport,
  inspectControlledDocument,
  renderArtifact,
  renderingLayoutProfiles,
} from "./index.js";
import {
  fixtureGeneratedAt as generatedAt,
  syntheticCv,
  wordCount,
} from "./synthetic-cv.fixture.js";

function pdfReport(artifact: DraftArtifact) {
  const rendered = renderArtifact(artifact, "pdf", { generatedAt });
  const observation = inspectControlledDocument(rendered);
  const report = buildRenderingQaReport({
    artifact,
    rendered,
    createdAt: generatedAt,
    viewerObservation: observation,
  });
  return { observation, report };
}

describe("standard two-page layout density", () => {
  it("fits a realistic CV of about 1,750 words on two Carlito pages", () => {
    const cv = syntheticCv(1.05);
    expect(wordCount(cv)).toBeGreaterThan(1700);
    expect(wordCount(cv)).toBeLessThan(1800);

    const { observation, report } = pdfReport(cv);
    expect(observation.pageCount).toBe(2);
    expect(observation.clippedText).toBe(false);
    expect(observation.orphanSectionIds).toEqual([]);
    expect(report.passed).toBe(true);

    const estimate = estimateDocumentLength(cv, renderingLayoutProfiles["standard-two-page"], {
      pageTarget: "two-page",
    });
    expect(estimate.estimatedPages).toBeLessThanOrEqual(2);
    expect(estimate.exceedsTarget).toBe(false);
    expect(estimate.warning).toBeUndefined();
  });

  it("leaves headroom: a CV of about 1,890 words still fits two pages", () => {
    const cv = syntheticCv(1.15);
    expect(wordCount(cv)).toBeGreaterThan(1850);
    const { observation, report } = pdfReport(cv);
    expect(observation.pageCount).toBe(2);
    expect(report.passed).toBe(true);
  });

  it("uses the dense typography the DOCX and PDF share", () => {
    const profile = renderingLayoutProfiles["standard-two-page"];
    expect(profile.typography.docxFontFamily).toBe("Calibri");
    expect(profile.typography.pdfFont).toBe("carlito");
    expect(profile.typography.bodyFontSizePt).toBeGreaterThanOrEqual(9);
    expect(profile.typography.bodyFontSizePt).toBeLessThanOrEqual(9.5);
    expect(profile.lineMetricsPt.body / profile.typography.bodyFontSizePt).toBeCloseTo(1.2, 1);
    expect(profile.marginsMm.left).toBeGreaterThanOrEqual(12);
    expect(profile.marginsMm.left).toBeLessThanOrEqual(14);
  });

  it("still exceeds two pages when the content is about 1.6 times longer", () => {
    const longer = syntheticCv(1.6);
    expect(wordCount(longer)).toBeGreaterThan(2500);
    expect(pdfReport(longer).observation.pageCount).toBeGreaterThan(2);
    const estimate = estimateDocumentLength(longer, renderingLayoutProfiles["standard-two-page"], {
      pageTarget: "two-page",
    });
    expect(estimate.exceedsTarget).toBe(true);
  });
});
