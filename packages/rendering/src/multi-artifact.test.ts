import type { DraftArtifact } from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";

import {
  extractTextFromRenderedDocument,
  renderArtifact,
  renderHtml,
  renderMarkdown,
  validateAtsExtractability,
} from "./index.js";

const sampleCoverLetter: DraftArtifact = {
  schemaVersion: 1,
  id: "artifact-cover-letter-1",
  kind: "cover-letter",
  version: 1,
  parentVersionId: null,
  createdAt: "2026-08-13T10:00:00.000Z",
  language: "en",
  sections: [
    {
      id: "sec-salutation",
      title: "Salutation",
      kind: "salutation",
      order: 0,
      blocks: [
        {
          id: "blk-cl-1",
          type: "paragraph",
          text: "Dear Hiring Team,",
          claimIds: [],
        },
      ],
    },
    {
      id: "sec-hook",
      title: "Introduction",
      kind: "hook",
      order: 1,
      blocks: [
        {
          id: "blk-cl-2",
          type: "paragraph",
          text: "I am writing to express my enthusiasm for the Senior Distributed Systems Engineer role. With over 8 years building resilient Node.js and TypeScript backends, I look forward to contributing to your core infrastructure.",
          claimIds: ["cl-claim-1"],
        },
      ],
    },
    {
      id: "sec-body",
      title: "Core Alignment",
      kind: "alignment",
      order: 2,
      blocks: [
        {
          id: "blk-cl-3",
          type: "paragraph",
          text: "In my previous role, I led the migration to an event-driven architecture that reduced p99 latency by 45% across 200,000 daily active users.",
          claimIds: ["cl-claim-2"],
        },
      ],
    },
    {
      id: "sec-closing",
      title: "Closing",
      kind: "closing",
      order: 3,
      blocks: [
        {
          id: "blk-cl-4",
          type: "paragraph",
          text: "Thank you for your time and consideration. Sincerely, Candidate",
          claimIds: [],
        },
      ],
    },
  ],
  claims: [
    {
      id: "cl-claim-1",
      text: "With over 8 years building resilient Node.js and TypeScript backends, I look forward to contributing to your core infrastructure.",
      sectionId: "sec-hook",
      blockId: "blk-cl-2",
      substantive: true,
      status: "verified",
      evidence: [
        {
          sourcePath: "/sources/resume.md",
          excerpt: "8+ years building resilient Node.js and TypeScript backends",
        },
      ],
    },
    {
      id: "cl-claim-2",
      text: "In my previous role, I led the migration to an event-driven architecture that reduced p99 latency by 45% across 200,000 daily active users.",
      sectionId: "sec-body",
      blockId: "blk-cl-3",
      substantive: true,
      status: "verified",
      evidence: [
        {
          sourcePath: "/sources/resume.md",
          excerpt: "reduced p99 latency by 45% across 200,000 daily active users",
        },
      ],
    },
  ],
  decisions: [],
};

const sampleApplicationQa: DraftArtifact = {
  schemaVersion: 1,
  id: "artifact-qa-1",
  kind: "application-qa",
  version: 1,
  parentVersionId: null,
  createdAt: "2026-08-13T10:00:00.000Z",
  language: "en",
  sections: [
    {
      id: "sec-q1",
      title: "Why are you interested in this role?",
      kind: "question",
      order: 0,
      blocks: [
        {
          id: "blk-qa-1",
          type: "paragraph",
          text: "I specialize in local-first, privacy-respecting software and want to advance the reliable author-critic AI architecture at scale.",
          claimIds: ["qa-claim-1"],
        },
      ],
    },
    {
      id: "sec-q2",
      title: "Describe a technical challenge you resolved.",
      kind: "question",
      order: 1,
      blocks: [
        {
          id: "blk-qa-2",
          type: "paragraph",
          text: "I rearchitected our SQLite persistence layer to enforce append-only audit verification and zero-leakage diagnostic reporting.",
          claimIds: ["qa-claim-2"],
        },
      ],
    },
  ],
  claims: [
    {
      id: "qa-claim-1",
      text: "I specialize in local-first, privacy-respecting software and want to advance the reliable author-critic AI architecture at scale.",
      sectionId: "sec-q1",
      blockId: "blk-qa-1",
      substantive: false,
      status: "unverified",
      evidence: [],
    },
    {
      id: "qa-claim-2",
      text: "I rearchitected our SQLite persistence layer to enforce append-only audit verification and zero-leakage diagnostic reporting.",
      sectionId: "sec-q2",
      blockId: "blk-qa-2",
      substantive: true,
      status: "verified",
      evidence: [
        {
          sourcePath: "/sources/portfolio.md",
          excerpt: "rearchitected SQLite persistence layer with append-only audit",
        },
      ],
    },
  ],
  decisions: [],
};

describe("Multi-Artifact Kinds (Cover Letter & Application Q&A)", () => {
  it("renders cover letter markdown without redundant headings for salutation/closing", () => {
    const markdown = renderMarkdown(sampleCoverLetter);
    expect(markdown).toContain("Dear Hiring Team,");
    expect(markdown).toContain("## Introduction");
    expect(markdown).toContain("## Core Alignment");
    expect(markdown).toContain("Thank you for your time and consideration.");
    expect(markdown).not.toContain("## Salutation");
    expect(markdown).not.toContain("## Closing");
  });

  it("renders cover letter across all formats with ATS compatibility", () => {
    for (const format of ["markdown", "pdf", "docx"] as const) {
      const rendered = renderArtifact(sampleCoverLetter, format);
      const atsReport = validateAtsExtractability(rendered, sampleCoverLetter);

      expect(atsReport.passed).toBe(true);
      expect(atsReport.tokenRecoveryRate).toBeGreaterThanOrEqual(0.85);
      expect(atsReport.recoveredText).toContain("Dear Hiring Team");
    }
  });

  it("renders application Q&A across all formats with ATS compatibility", () => {
    const html = renderHtml(sampleApplicationQa);
    expect(html).toContain("DraftLoop Application Q&amp;A");
    expect(html).toContain("Why are you interested in this role?");

    for (const format of ["markdown", "pdf", "docx"] as const) {
      const rendered = renderArtifact(sampleApplicationQa, format);
      const extracted = extractTextFromRenderedDocument(rendered);
      expect(extracted).toContain("Why are you interested in this role?");
      expect(extracted).toContain("persistence");
    }
  });
});
