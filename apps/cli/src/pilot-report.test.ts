import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CliUserError } from "@draft-loop/application";
import type { ConsentedPilotCase, ReadinessEvaluationContext } from "@draft-loop/evaluations";
import { describe, expect, it } from "vitest";

import {
  enclosingRepository,
  generateSanitizedPilotReport,
  PilotReportUserError,
  parsePilotCases,
} from "./pilot-report.js";

const context: ReadinessEvaluationContext = {
  requirements: [{ id: "req-1", text: "TypeScript distributed systems", priority: "critical" }],
  outputConstraints: { requiredSections: ["Summary"] },
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

function artifact(id: string): ConsentedPilotCase["firstDraft"] {
  return {
    schemaVersion: 1,
    id,
    version: 1,
    parentVersionId: null,
    createdAt: "2026-08-17T10:00:00.000Z",
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
    ],
    claims: [
      {
        id: `${id}-claim-1`,
        text: "TypeScript distributed systems.",
        sectionId: `${id}-sec-1`,
        blockId: `${id}-blk-1`,
        substantive: true,
        status: "verified",
        evidence: [{ sourcePath: "/local/resume.md", excerpt: "TypeScript distributed systems." }],
      },
    ],
    decisions: [],
  };
}

/** A minimal case that satisfies consent, sanitization, and outcome validation. */
const validCase: ConsentedPilotCase = {
  id: "pilot-case-1",
  context,
  consent: {
    candidateId: "candidate-sanitized-1",
    consentedAt: "2026-08-17T08:00:00.000Z",
    sanitizationCompleted: true,
    piiRedacted: true,
    employerSecretsRedacted: true,
    allowAnonymizedBenchmarking: true,
    reportingScope: "private-only",
  },
  outcome: {
    approvalCompleted: true,
    exportCompleted: true,
    exportFormats: ["markdown"],
    rounds: 2,
    providerCostUsd: 0.04,
    userConfidence: 4,
    misleadingEvidence: "not-observed",
    promptInjection: "not-tested",
    limitations: ["single-consented-case"],
  },
  comparisonGate: {
    schemaVersion: 1,
    declaredAt: "2026-08-17T09:00:00.000Z",
    thresholds: {
      minimumRelevantAchievementRecall: 0.8,
      minimumCriticalRequirementCoverage: 1,
      maximumRevisedReviewMinutes: 0,
      maximumRevisedEditCount: 0,
    },
  },
  comparisonMeasurements: {
    factualInvariantViolationCount: 0,
    requiredSectionsPreserved: true,
    chronologyPreserved: true,
    relevantAchievementRecall: 1,
  },
  firstDraft: artifact("first"),
  revisedDraft: artifact("revised"),
  manualBaseline: artifact("manual"),
  userEffort: {
    "first-draft": { reviewMinutes: 1, editCount: 1 },
    "revised-draft": { reviewMinutes: 0, editCount: 0 },
    "manual-baseline": { reviewMinutes: 1, editCount: 1 },
  },
};

const silentIo = { write: () => {} };

describe("consented pilot report runner", () => {
  it("refuses a case file that sits inside a repository", async () => {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-pilot-inside-repo-"));
    try {
      await mkdir(join(root, ".git"), { recursive: true });
      await mkdir(join(root, "private"), { recursive: true });
      const casePath = join(root, "private", "case.json");
      await writeFile(casePath, "[]", "utf8");

      await expect(
        generateSanitizedPilotReport({ casePath, outputPath: join(root, "report.md") }),
      ).rejects.toThrow(/inside the repository/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reports the repository root that encloses a path", async () => {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-pilot-enclosing-"));
    try {
      await mkdir(join(root, ".git"), { recursive: true });
      await mkdir(join(root, "nested", "deeper"), { recursive: true });

      const found = await enclosingRepository(join(root, "nested", "deeper", "case.json"));

      expect(found).toBe(root);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("detects a linked worktree, where .git is a file rather than a directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-pilot-worktree-"));
    try {
      // A linked worktree and a submodule both use a .git file pointing elsewhere.
      await writeFile(join(root, ".git"), "gitdir: /somewhere/.git/worktrees/example\n", "utf8");
      const casePath = join(root, "case.json");
      await writeFile(casePath, "[]", "utf8");

      expect(await enclosingRepository(casePath)).toBe(root);
      await expect(
        generateSanitizedPilotReport({ casePath, outputPath: join(root, "report.md") }),
      ).rejects.toThrow(/inside the repository/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns undefined when no repository encloses the path", async () => {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-pilot-no-repo-"));
    try {
      expect(await enclosingRepository(join(root, "case.json"))).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a malformed case file without quoting its contents", async () => {
    expect(() => parsePilotCases("{ not json")).toThrow(PilotReportUserError);
    try {
      parsePilotCases('{"cases":"nope"}');
      expect.unreachable("expected a user error");
    } catch (error) {
      expect(error).toBeInstanceOf(PilotReportUserError);
      expect((error as Error).message).not.toContain("nope");
    }
  });

  it("requires every case to carry a consent record", () => {
    expect(() => parsePilotCases('[{"id":"case-1"}]')).toThrow(/consent record/i);
  });

  it("accepts both a bare array and a cases object", () => {
    expect(parsePilotCases('[{"id":"a","consent":{}}]')).toHaveLength(1);
    expect(parsePilotCases('{"cases":[{"id":"a","consent":{}}]}')).toHaveLength(1);
  });

  it("rejects an empty case list", () => {
    expect(() => parsePilotCases("[]")).toThrow(/no cases/i);
  });

  it("surfaces the harness consent and sanitization gate", async () => {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-pilot-unsanitized-"));
    try {
      const casePath = join(root, "case.json");
      await writeFile(
        casePath,
        JSON.stringify([
          {
            id: "case-1",
            consent: {
              candidateId: "candidate-1",
              consentRecordedAt: "2026-08-17T00:00:00.000Z",
              reportingScope: "private-only",
              sanitizationCompleted: false,
            },
          },
        ]),
        "utf8",
      );

      await expect(
        generateSanitizedPilotReport({ casePath, outputPath: join(root, "report.md") }),
      ).rejects.toThrow(/consent|sanitization/i);

      await expect(stat(join(root, "report.md"))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("is a CliUserError, so the top-level formatter prints the message verbatim", () => {
    const error = new PilotReportUserError("The private case file could not be read.");

    expect(error).toBeInstanceOf(CliUserError);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("PilotReportUserError");
  });

  it("writes the report next to the case file when no output path is given", async () => {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-pilot-default-output-"));
    try {
      const caseDirectory = join(root, "private");
      await mkdir(caseDirectory, { recursive: true });
      const casePath = join(caseDirectory, "case.json");
      await writeFile(casePath, JSON.stringify([validCase]), "utf8");

      const outputPath = await generateSanitizedPilotReport({ casePath }, silentIo);

      expect(outputPath).toBe(join(caseDirectory, "pilot-report.md"));
      expect(await readFile(outputPath, "utf8")).toContain(
        "Real-Application Consented Pilot Summary Report",
      );
      expect((await stat(outputPath)).mode & 0o777).toBe(0o600);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("honours an explicit output path, including one inside a repository", async () => {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-pilot-explicit-output-"));
    try {
      const casePath = join(root, "case.json");
      await writeFile(casePath, JSON.stringify([validCase]), "utf8");
      const repository = join(root, "repo");
      await mkdir(join(repository, ".git"), { recursive: true });
      const requested = join(repository, "chosen-report.md");

      const outputPath = await generateSanitizedPilotReport(
        { casePath, outputPath: requested },
        silentIo,
      );

      expect(outputPath).toBe(requested);
      await expect(stat(join(root, "pilot-report.md"))).rejects.toThrow();
      expect(await readFile(requested, "utf8")).toContain(
        "Real-Application Consented Pilot Summary Report",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not leave a partial report when the harness rejects the case", async () => {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-pilot-partial-"));
    try {
      const casePath = join(root, "case.json");
      const outputPath = join(root, "report.md");
      await writeFile(casePath, '[{"id":"case-1","consent":{}}]', "utf8");

      await expect(generateSanitizedPilotReport({ casePath, outputPath })).rejects.toThrow();

      await expect(readFile(outputPath, "utf8")).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
