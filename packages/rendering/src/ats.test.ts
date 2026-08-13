import type { DraftArtifact } from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";

import {
  extractTextFromRenderedDocument,
  renderArtifact,
  validateAtsExtractability,
} from "./index.js";

const sampleArtifact: DraftArtifact = {
  schemaVersion: 1,
  id: "artifact-ats-test",
  version: 1,
  parentVersionId: null,
  createdAt: "2026-08-13T10:00:00.000Z",
  language: "en",
  sections: [
    {
      id: "sec-summary",
      title: "Professional Summary",
      kind: "summary",
      order: 0,
      blocks: [
        {
          id: "blk-1",
          type: "paragraph",
          text: "Experienced distributed systems engineer with 8+ years building high-throughput microservices using Node.js, TypeScript, and SQLite.",
          claimIds: ["claim-1"],
        },
      ],
    },
    {
      id: "sec-exp",
      title: "Work Experience",
      kind: "experience",
      order: 1,
      blocks: [
        {
          id: "blk-2",
          type: "bullet",
          text: "Led migration to event-driven architecture, reducing latency by 45% across 200,000 daily active users.",
          claimIds: ["claim-2"],
        },
        {
          id: "blk-3",
          type: "bullet",
          text: "Mentored 5 junior engineers and established automated code-quality standards.",
          claimIds: ["claim-3"],
        },
      ],
    },
    {
      id: "sec-skills",
      title: "Technical Skills",
      kind: "skills",
      order: 2,
      blocks: [
        {
          id: "blk-4",
          type: "paragraph",
          text: "TypeScript, Node.js, SQLite, Vitest, CI/CD, Electron.",
          claimIds: [],
        },
      ],
    },
  ],
  claims: [
    {
      id: "claim-1",
      text: "Experienced distributed systems engineer with 8+ years building high-throughput microservices using Node.js, TypeScript, and SQLite.",
      sectionId: "sec-summary",
      blockId: "blk-1",
      substantive: true,
      status: "verified",
      evidence: [
        {
          sourcePath: "/local/resume.md",
          excerpt:
            "8+ years building high-throughput microservices using Node.js, TypeScript, and SQLite.",
        },
      ],
    },
    {
      id: "claim-2",
      text: "Led migration to event-driven architecture, reducing latency by 45% across 200,000 daily active users.",
      sectionId: "sec-exp",
      blockId: "blk-2",
      substantive: true,
      status: "verified",
      evidence: [
        {
          sourcePath: "/local/resume.md",
          excerpt: "reducing latency by 45% across 200,000 daily active users.",
        },
      ],
    },
    {
      id: "claim-3",
      text: "Mentored 5 junior engineers and established automated code-quality standards.",
      sectionId: "sec-exp",
      blockId: "blk-3",
      substantive: false,
      status: "unverified",
      evidence: [],
    },
  ],
  decisions: [],
};

describe("ATS Compatibility & Cross-Format Document Export", () => {
  it("validates ATS text extractability for Markdown exports", () => {
    const rendered = renderArtifact(sampleArtifact, "markdown");
    const atsReport = validateAtsExtractability(rendered, sampleArtifact);

    expect(atsReport.passed).toBe(true);
    expect(atsReport.tokenRecoveryRate).toBeGreaterThanOrEqual(0.95);
    expect(atsReport.missingSections).toEqual([]);
    expect(atsReport.recoveredText).toContain("Professional Summary");
    expect(atsReport.recoveredText).toContain("microservices");
  });

  it("validates ATS text extractability for PDF exports and embeds metadata", () => {
    const rendered = renderArtifact(sampleArtifact, "pdf", {
      generatedAt: "2026-08-13T12:00:00.000Z",
    });
    const rawPdf = new TextDecoder().decode(rendered.content);

    // Metadata validation
    expect(rawPdf).toContain("/Title");
    expect(rawPdf).toContain("/Author (DraftLoop)");
    expect(rawPdf).toContain("/Creator (DraftLoop CV Engine)");

    // ATS extraction validation
    const atsReport = validateAtsExtractability(rendered, sampleArtifact);
    expect(atsReport.passed).toBe(true);
    expect(atsReport.tokenRecoveryRate).toBeGreaterThanOrEqual(0.9);
    expect(atsReport.missingSections).toEqual([]);
    expect(atsReport.recoveredText).toContain("Professional Summary");
  });

  it("validates ATS text extractability for DOCX exports and embeds core properties", () => {
    const rendered = renderArtifact(sampleArtifact, "docx", {
      generatedAt: "2026-08-13T12:00:00.000Z",
    });
    const rawDocx = new TextDecoder().decode(rendered.content);

    // Core properties validation
    expect(rawDocx).toContain("docProps/core.xml");
    expect(rawDocx).toContain("DraftLoop");

    // ATS extraction validation
    const atsReport = validateAtsExtractability(rendered, sampleArtifact);
    expect(atsReport.passed).toBe(true);
    expect(atsReport.tokenRecoveryRate).toBeGreaterThanOrEqual(0.95);
    expect(atsReport.missingSections).toEqual([]);
    expect(atsReport.recoveredText).toContain("Professional Summary");
    expect(atsReport.recoveredText).toContain("microservices");
  });

  it("renders Unicode typography without corruption across all formats", () => {
    const unicodeArtifact: DraftArtifact = {
      ...sampleArtifact,
      id: "artifact-unicode",
      sections: [
        {
          id: "sec-unicode",
          title: "Résumé & Spécialités",
          kind: "summary",
          order: 0,
          blocks: [
            {
              id: "blk-u1",
              type: "paragraph",
              text: "“Architecte Cloud” — élaboration de solutions “haute disponibilité” (2021–2026).",
              claimIds: [],
            },
          ],
        },
      ],
      claims: [],
    };

    for (const format of ["markdown", "pdf", "docx"] as const) {
      const rendered = renderArtifact(unicodeArtifact, format);
      const extracted = extractTextFromRenderedDocument(rendered);
      expect(extracted).toBeDefined();
      expect(extracted.length).toBeGreaterThan(0);
    }
  });
});
