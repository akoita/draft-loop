import { describe, expect, it } from "vitest";

import {
  renderingQaActiveContentSchema,
  renderingQaReportSchema,
  renderingQaViewerObservationSchema,
} from "./index.js";

const checksum = (value: string): string => value.repeat(64).slice(0, 64);

function rendered(overrides: Record<string, unknown> = {}) {
  return {
    artifactId: "artifact-1",
    artifactVersion: 1,
    format: "markdown",
    generatedAt: "2026-08-26T10:00:00.000Z",
    templateVersion: "cv-controlled-v1",
    layoutProfile: "standard-two-page",
    checksum: checksum("a"),
    sourceContentChecksum: checksum("b"),
    ...overrides,
  };
}

function integrity(overrides: Record<string, unknown> = {}) {
  return {
    expectedVisibleContentChecksum: checksum("c"),
    recoveredVisibleContentChecksum: checksum("c"),
    expectedVisibleContentCount: 8,
    recoveredVisibleContentCount: 8,
    visibleContentMatches: true,
    sectionOrderMatches: true,
    blockOrderMatches: true,
    duplicateContentPreserved: true,
    punctuationPreserved: true,
    ...overrides,
  };
}

function observation(overrides: Record<string, unknown> = {}) {
  return {
    renderedChecksum: checksum("a"),
    viewerName: "Local PDF Inspector",
    viewerVersion: "1.0.0",
    recoveredVisibleContentChecksum: checksum("c"),
    recoveredVisibleContentCount: 8,
    recoveredVisibleContentOrder: "preserved",
    pageCount: 2,
    blankPageNumbers: [],
    overflowPageNumbers: [],
    orphanSectionIds: [],
    clippedText: false,
    ...overrides,
  };
}

function report(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    artifact: { id: "artifact-1", version: 1 },
    rendered: rendered(),
    createdAt: "2026-08-26T10:05:00.000Z",
    contentIntegrity: integrity(),
    activeContent: { detected: false, signatures: [] },
    targetPageCount: 2,
    deterministicPageCount: null,
    viewerObservation: null,
    limitations: [
      "deterministic-page-count-not-assessed",
      "structured-images-unsupported",
      "structured-links-unsupported",
    ],
    deterministicPassed: true,
    complete: true,
    passed: true,
    ...overrides,
  };
}

describe("rendering QA schemas", () => {
  it("accepts a content-free deterministic Markdown report", () => {
    const parsed = renderingQaReportSchema.parse(report());
    expect(parsed.viewerObservation).toBeNull();
    expect(parsed.passed).toBe(true);
    expect(JSON.stringify(parsed)).not.toContain("candidate");
    expect(JSON.stringify(parsed)).not.toContain("sourcePath");
  });

  it("requires independent observation for PDF and DOCX completeness", () => {
    const pdf = report({
      rendered: rendered({ format: "pdf" }),
      deterministicPageCount: 2,
      viewerObservation: null,
      limitations: [
        "independent-viewer-observation-not-run",
        "structured-images-unsupported",
        "structured-links-unsupported",
      ],
      deterministicPassed: true,
      complete: false,
      passed: false,
    });
    expect(renderingQaReportSchema.safeParse(pdf).success).toBe(true);

    const observedPdf = report({
      rendered: rendered({ format: "pdf" }),
      deterministicPageCount: 2,
      viewerObservation: observation(),
      limitations: ["structured-images-unsupported", "structured-links-unsupported"],
      deterministicPassed: true,
      complete: true,
      passed: true,
    });
    expect(renderingQaReportSchema.safeParse(observedPdf).success).toBe(true);
  });

  it("rejects contradictory derived fields and checksum bindings", () => {
    expect(renderingQaReportSchema.safeParse(report({ deterministicPassed: false })).success).toBe(
      false,
    );
    expect(
      renderingQaReportSchema.safeParse(
        report({ contentIntegrity: integrity({ visibleContentMatches: false }) }),
      ).success,
    ).toBe(false);
    expect(
      renderingQaReportSchema.safeParse(
        report({ viewerObservation: observation({ renderedChecksum: checksum("z") }) }),
      ).success,
    ).toBe(false);
    expect(
      renderingQaViewerObservationSchema.safeParse(observation({ blankPageNumbers: [2, 1] }))
        .success,
    ).toBe(false);
    expect(
      renderingQaViewerObservationSchema.safeParse(observation({ overflowPageNumbers: [2, 2] }))
        .success,
    ).toBe(false);
  });

  it("derives target pages, chronology, page-count nullability, and exact limitations", () => {
    expect(renderingQaReportSchema.safeParse(report({ targetPageCount: 1 })).success).toBe(false);
    expect(
      renderingQaReportSchema.safeParse(
        report({
          limitations: [...report().limitations, "independent-viewer-observation-not-run"],
        }),
      ).success,
    ).toBe(false);
    expect(
      renderingQaReportSchema.safeParse(report({ createdAt: "2026-08-26T09:59:59.000Z" })).success,
    ).toBe(false);
    expect(renderingQaReportSchema.safeParse(report({ deterministicPageCount: 2 })).success).toBe(
      false,
    );

    const mismatchedPdfObservation = report({
      rendered: rendered({ format: "pdf" }),
      deterministicPageCount: 2,
      viewerObservation: observation({ pageCount: 1 }),
      limitations: ["structured-images-unsupported", "structured-links-unsupported"],
      deterministicPassed: true,
      complete: true,
      passed: true,
    });
    expect(renderingQaReportSchema.safeParse(mismatchedPdfObservation).success).toBe(false);
  });

  it("rejects raw content/provider fields and validates active-content signals", () => {
    expect(
      renderingQaReportSchema.safeParse(report({ recoveredText: "candidate text" })).success,
    ).toBe(false);
    expect(
      renderingQaReportSchema.safeParse(report({ chainOfThought: "hidden reasoning" })).success,
    ).toBe(false);
    expect(
      renderingQaReportSchema.safeParse(
        report({ activeContent: { detected: true, signatures: [] }, deterministicPassed: false }),
      ).success,
    ).toBe(false);
    expect(
      renderingQaActiveContentSchema.safeParse({
        detected: true,
        signatures: ["pdf-javascript", "pdf-javascript"],
      }).success,
    ).toBe(false);
  });
});
