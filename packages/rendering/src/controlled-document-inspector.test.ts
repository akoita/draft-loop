import { createHash } from "node:crypto";

import type { DraftArtifact } from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";

import { buildRenderingQaReport, inspectControlledDocument, renderArtifact } from "./index.js";

const generatedAt = "2026-08-30T10:00:00.000Z";
const checksum = (content: Uint8Array): string =>
  createHash("sha256").update(content).digest("hex");

function artifact(overrides: Partial<DraftArtifact> = {}): DraftArtifact {
  return {
    schemaVersion: 1,
    id: "artifact-inspector",
    version: 1,
    parentVersionId: null,
    createdAt: generatedAt,
    language: "en",
    sections: [
      {
        id: "summary",
        title: "Summary",
        kind: "summary",
        order: 0,
        blocks: [{ id: "summary-1", type: "paragraph", text: "First milestone.", claimIds: [] }],
      },
      {
        id: "experience",
        title: "Experience",
        kind: "experience",
        order: 1,
        blocks: [
          { id: "experience-1", type: "bullet", text: "Second milestone.", claimIds: [] },
          { id: "experience-2", type: "bullet", text: "Third milestone.", claimIds: [] },
        ],
      },
    ],
    claims: [],
    decisions: [],
    ...overrides,
  };
}

function withContent(
  rendered: ReturnType<typeof renderArtifact>,
  content: Uint8Array,
): ReturnType<typeof renderArtifact> {
  return {
    ...rendered,
    content,
    metadata: { ...rendered.metadata, checksum: checksum(content) },
  };
}

describe("controlled document byte inspector", () => {
  it("inspects a controlled PDF without blank, clipped, or overflow pages", () => {
    const sample = artifact();
    const rendered = renderArtifact(sample, "pdf", { generatedAt });
    const observation = inspectControlledDocument(rendered);

    expect(observation.viewerName).toMatch(/controlled PDF byte inspector/u);
    expect(observation.pageCount).toBe(1);
    expect(observation.blankPageNumbers).toEqual([]);
    expect(observation.overflowPageNumbers).toEqual([]);
    expect(observation.orphanSectionIds).toEqual([]);
    expect(observation.clippedText).toBe(false);
    const report = buildRenderingQaReport({
      artifact: sample,
      rendered,
      createdAt: generatedAt,
      viewerObservation: observation,
    });
    expect(report.complete).toBe(true);
    expect(report.passed).toBe(true);

    const twoPageArtifact = artifact({
      id: "artifact-inspector-two-page",
      sections: (() => {
        const base = artifact();
        const summary = base.sections[0];
        const experience = base.sections[1];
        if (summary === undefined || experience === undefined) throw new Error("missing fixture");
        return [
          summary,
          {
            ...experience,
            blocks: Array.from({ length: 45 }, (_, index) => ({
              id: `experience-${index}`,
              type: "bullet" as const,
              text: `Chronology milestone ${index} remains in order.`,
              claimIds: [],
            })),
          },
        ];
      })(),
    });
    const twoPage = renderArtifact(twoPageArtifact, "pdf", { generatedAt });
    const twoPageObservation = inspectControlledDocument(twoPage);
    expect(twoPageObservation.pageCount).toBe(2);
    expect(twoPageObservation.blankPageNumbers).toEqual([]);
    expect(twoPageObservation.overflowPageNumbers).toEqual([]);
    expect(twoPageObservation.clippedText).toBe(false);
  });

  it("inspects DOCX OOXML order and retains the visual-pagination limitation", () => {
    const sample = artifact();
    const rendered = renderArtifact(sample, "docx", { generatedAt });
    const observation = inspectControlledDocument(rendered);
    const report = buildRenderingQaReport({
      artifact: sample,
      rendered,
      createdAt: generatedAt,
      viewerObservation: observation,
    });

    expect(observation.viewerName).toMatch(/controlled DOCX OOXML inspector/u);
    expect(observation.pageCount).toBe(1);
    expect(observation.recoveredVisibleContentOrder).toBe("preserved");
    expect(report.contentIntegrity.visibleContentMatches).toBe(true);
    expect(report.contentIntegrity.sectionOrderMatches).toBe(true);
    expect(report.contentIntegrity.blockOrderMatches).toBe(true);
    expect(report.limitations).toContain("deterministic-page-count-not-assessed");
    expect(report.complete).toBe(true);
    expect(report.passed).toBe(true);
  });

  it("detects clipped PDF text and rejects truncated or broken documents", () => {
    const sample = artifact();
    const pdf = renderArtifact(sample, "pdf", { generatedAt });
    const rawPdf = new TextDecoder().decode(pdf.content);
    const clippedPdf = withContent(
      pdf,
      new TextEncoder().encode(rawPdf.replace(/1 0 0 1 [0-9.]+ /u, "1 0 0 1 -10.0000 ")),
    );
    // A malformed/truncated byte stream must not become a fabricated observation.
    expect(() => inspectControlledDocument(withContent(pdf, pdf.content.slice(0, -24)))).toThrow(
      /PDF|object|page|stream|signature/u,
    );
    expect(() => inspectControlledDocument(clippedPdf)).not.toThrow();
    expect(inspectControlledDocument(clippedPdf).clippedText).toBe(true);
    expect(
      buildRenderingQaReport({
        artifact: sample,
        rendered: clippedPdf,
        createdAt: generatedAt,
        viewerObservation: inspectControlledDocument(clippedPdf),
      }).passed,
    ).toBe(false);

    const original = new TextDecoder().decode(pdf.content);
    const reorderedPdf = original
      .replace("(First milestone.)", "(XXXXXXXXXXXXXXXX)")
      .replace("(Third milestone.)", "(First milestone.)")
      .replace("(XXXXXXXXXXXXXXXX)", "(Third milestone.)");
    const reordered = withContent(pdf, new TextEncoder().encode(reorderedPdf));
    const reorderedReport = buildRenderingQaReport({
      artifact: sample,
      rendered: reordered,
      createdAt: generatedAt,
      viewerObservation: inspectControlledDocument(reordered),
    });
    expect(reorderedReport.contentIntegrity.blockOrderMatches).toBe(false);
    expect(reorderedReport.passed).toBe(false);
  });

  it("fails closed when DOCX package bytes are truncated", () => {
    const sample = artifact();
    const docx = renderArtifact(sample, "docx", { generatedAt });
    expect(() => inspectControlledDocument(withContent(docx, docx.content.slice(0, -18)))).toThrow(
      /DOCX|ZIP|entry|directory|record/u,
    );
  });
});
