import type { DraftArtifact } from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";

import {
  type ConsentedPilotCase,
  type PilotConsentRecord,
  type ReadinessEvaluationContext,
  runConsentedPilotHarness,
  validatePilotConsent,
} from "./index.js";

const context: ReadinessEvaluationContext = {
  requirements: [
    { id: "req-1", text: "TypeScript distributed systems", priority: "critical" },
    { id: "req-2", text: "SQLite database storage", priority: "critical" },
  ],
  outputConstraints: { requiredSections: ["Summary", "Experience"] },
  readinessRubric: {
    relevance: 0.7,
    evidence: 0.7,
    accuracy: 0.7,
    differentiation: 0.7,
    clarity: 0.7,
    format: 0.7,
    credibility: 0.7,
  },
};

function artifact(id: string, full = true): DraftArtifact {
  return {
    schemaVersion: 1,
    id,
    version: 1,
    parentVersionId: null,
    createdAt: "2026-08-13T10:00:00.000Z",
    language: "en",
    sections: [
      {
        id: `${id}-sec-1`,
        title: "Summary",
        kind: "summary",
        order: 0,
        blocks: [
          {
            id: `${id}-blk-1`,
            type: "paragraph",
            text: "TypeScript distributed systems.",
            claimIds: [`${id}-claim-1`],
          },
        ],
      },
      ...(full
        ? [
            {
              id: `${id}-sec-2`,
              title: "Experience",
              kind: "experience" as const,
              order: 1,
              blocks: [
                {
                  id: `${id}-blk-2`,
                  type: "paragraph" as const,
                  text: "SQLite database storage.",
                  claimIds: [`${id}-claim-2`],
                },
              ],
            },
          ]
        : []),
    ],
    claims: [
      {
        id: `${id}-claim-1`,
        text: "TypeScript distributed systems.",
        sectionId: `${id}-sec-1`,
        blockId: `${id}-blk-1`,
        substantive: true,
        status: "verified",
        evidence: [
          {
            sourcePath: "/local/resume.md",
            excerpt: "TypeScript distributed systems.",
          },
        ],
      },
      ...(full
        ? [
            {
              id: `${id}-claim-2`,
              text: "SQLite database storage.",
              sectionId: `${id}-sec-2`,
              blockId: `${id}-blk-2`,
              substantive: true,
              status: "verified" as const,
              evidence: [
                {
                  sourcePath: "/local/resume.md",
                  excerpt: "SQLite database storage.",
                },
              ],
            },
          ]
        : []),
    ],
    decisions: [],
  };
}

const consent: PilotConsentRecord = {
  candidateId: "candidate-sanitized-1",
  consentedAt: "2026-08-13T12:00:00.000Z",
  sanitizationCompleted: true,
  piiRedacted: true,
  employerSecretsRedacted: true,
  allowAnonymizedBenchmarking: true,
};

const pilotCase: ConsentedPilotCase = {
  id: "pilot-case-1",
  context,
  consent,
  firstDraft: artifact("first", false),
  revisedDraft: artifact("revised", true),
  manualBaseline: artifact("manual", true),
  userEffort: {
    "first-draft": { reviewMinutes: 15, editCount: 6, approvalCount: 0 },
    "revised-draft": { reviewMinutes: 8, editCount: 2, approvalCount: 1 },
    "manual-baseline": { reviewMinutes: 25, editCount: 12, approvalCount: 1 },
  },
  findingsDisposition: {
    usefulCount: 4,
    rejectedCount: 1,
  },
};

describe("Consented Real-Application Pilot Harness", () => {
  it("enforces complete consent and sanitization verification", () => {
    expect(() => validatePilotConsent(consent)).not.toThrow();

    expect(() => validatePilotConsent({ ...consent, sanitizationCompleted: false })).toThrow(
      /sanitization/,
    );

    expect(() => validatePilotConsent({ ...consent, piiRedacted: false })).toThrow(/sanitization/);

    expect(() => validatePilotConsent({ ...consent, allowAnonymizedBenchmarking: false })).toThrow(
      /sanitization/,
    );
  });

  it("runs comparative tri-variant evaluation and generates a zero-leakage pilot report", () => {
    const report = runConsentedPilotHarness([pilotCase]);

    expect(report.caseCount).toBe(1);
    expect(report.variants["first-draft"].averageReadinessRate).toBe(0);
    expect(report.variants["revised-draft"].averageReadinessRate).toBe(1);
    expect(report.variants["manual-baseline"].averageReadinessRate).toBe(1);

    expect(report.variants["revised-draft"].averageReviewMinutes).toBe(8);
    expect(report.variants["manual-baseline"].averageReviewMinutes).toBe(25);

    expect(report.criticEfficiency.totalUsefulFindings).toBe(4);
    expect(report.criticEfficiency.totalRejectedFindings).toBe(1);
    expect(report.criticEfficiency.usefulFindingRatio).toBe(0.8);

    expect(report.hypothesisValidation.factualityPreservedOrImproved).toBe(true);
    expect(report.hypothesisValidation.effortReducedComparedToManual).toBe(true);

    // Markdown report verification
    expect(report.markdownReport).toContain("Real-Application Consented Pilot Summary Report");
    expect(report.markdownReport).toContain("Tri-Variant Quality & Effort Comparison");
    expect(report.markdownReport).toContain("**Useful Finding Ratio:** 80.0%");
    expect(report.markdownReport).not.toContain("candidate-sanitized-1");
  });
});
