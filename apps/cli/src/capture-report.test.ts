import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CliUserError } from "@draft-loop/application";
import { describe, expect, it } from "vitest";

import { CaptureReportUserError, printRejectedAuthorCaptureReport } from "./capture-report.js";

const sentinel = "SENTINELZQX";
const evidenceText = `Built reliable TypeScript tools at ${sentinel}.`;

/** Extra run-context snapshot fields the capture writer stores beside the validation inputs. */
const snapshotContext = {
  schemaVersion: 1,
  id: `context-${sentinel}`,
  workspaceId: `workspace-${sentinel}`,
  createdAt: "2026-09-19T15:00:00.000Z",
  jobDescription: `Job description ${sentinel}`,
  requirements: [{ id: "req-1", text: `Requirement ${sentinel}`, priority: "critical" }],
  candidateInstructions: `Instructions ${sentinel}`,
  outputConstraints: { requiredSections: ["Summary"] },
  truthfulnessPolicy: { forbidInventedMetrics: true },
  readinessRubric: { relevance: 0.7 },
  modelConfiguration: { author: { provider: "anthropic", modelId: `model-${sentinel}` } },
  candidateKnowledgeSelection: { mode: "all" },
};

function capture(capturedAt: string, blockText: string, fullContext = false) {
  return {
    schemaVersion: 1,
    capturedAt,
    provider: "openai",
    modelId: `model-${sentinel}`,
    validationInputs: {
      proposal: {
        sections: [
          {
            title: `Title ${sentinel}`,
            kind: "summary",
            blocks: [
              {
                type: "paragraph",
                text: blockText,
                claims: [{ text: blockText, substantive: true, evidenceChunkIds: ["chunk-1"] }],
              },
            ],
          },
        ],
      },
      executionId: `execution-${sentinel}`,
      context: {
        ...(fullContext ? snapshotContext : {}),
        language: "en",
        evidenceManifest: [
          {
            id: "source-1",
            path: `/private/${sentinel}.md`,
            checksum: "a".repeat(64),
            ...(fullContext ? { mediaType: "text/markdown" } : {}),
          },
        ],
      },
      retrievedEvidence: [
        {
          id: "chunk-1",
          workspaceId: "workspace-1",
          sourceId: "source-1",
          ordinal: 0,
          lineStart: 1,
          lineEnd: 1,
          checksum: "b".repeat(64),
          text: evidenceText,
          rank: 0,
        },
      ],
      createdAt: capturedAt,
    },
    failureStage: "factual-invariant-rejection",
    diagnostics: [],
  };
}

async function writeCapture(root: string, name: string, value: unknown): Promise<void> {
  await mkdir(join(root, name));
  await writeFile(join(root, name, "replay.json"), JSON.stringify(value), "utf8");
}

function collectingIo() {
  const chunks: string[] = [];
  return { chunks, io: { write: (message: string) => void chunks.push(message) } };
}

describe("rejected author capture report", () => {
  it("refuses a capture directory inside a repository", async () => {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-capture-inside-repo-"));
    try {
      await mkdir(join(root, ".git"));
      const captures = join(root, "captures");
      await mkdir(captures);
      await writeCapture(captures, "rejected-author-a", capture("2026-09-19T15:00:00.000Z", "x"));
      const { chunks, io } = collectingIo();
      await expect(printRejectedAuthorCaptureReport(captures, io)).rejects.toThrow(
        /inside the repository/i,
      );
      await expect(printRejectedAuthorCaptureReport(root, io)).rejects.toThrow(
        /inside the repository/i,
      );
      expect(chunks).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("prints content-free counts for captures ordered by capture time", async () => {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-capture-report-"));
    try {
      // Directory names sort opposite to capture time, so order must follow capturedAt.
      await writeCapture(
        root,
        "rejected-author-a",
        // The writer stores the full context snapshot; the report must accept it.
        capture(
          "2026-09-19T16:00:00.000Z",
          `Built 999 reliable TypeScript tools at ${sentinel}.`,
          true,
        ),
      );
      await writeCapture(
        root,
        "rejected-author-b",
        capture("2026-09-19T15:00:00.000Z", evidenceText),
      );
      await mkdir(join(root, "unrelated"));
      await writeFile(join(root, "unrelated", "replay.json"), "not json", "utf8");
      const before = await readdir(root);

      const { chunks, io } = collectingIo();
      const summary = await printRejectedAuthorCaptureReport(root, io);

      const stdout = chunks.join("");
      expect(JSON.parse(stdout)).toEqual(summary);
      expect(summary).toMatchObject({
        total: 2,
        accepted: 1,
        rejected: 1,
        captures: [
          { index: 0, accepted: true, issueTotal: 0 },
          {
            index: 1,
            accepted: false,
            issueTotal: 1,
            codeCounts: [{ code: "factual_invariant_violation", count: 1 }],
            sectionCodeCounts: [
              { sectionKind: "summary", code: "factual_invariant_violation", count: 1 },
            ],
          },
        ],
      });
      expect(stdout).not.toContain(sentinel);
      expect(stdout).not.toContain("999");
      expect(stdout).not.toContain("Job description");
      expect(stdout).not.toContain("Instructions");
      expect(stdout).not.toContain(root);
      expect(await readdir(root)).toEqual(before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a malformed capture without quoting it", async () => {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-capture-malformed-"));
    try {
      await writeCapture(root, "rejected-author-a", { unexpected: sentinel });
      const { chunks, io } = collectingIo();
      const failure = await printRejectedAuthorCaptureReport(root, io).catch(
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(CaptureReportUserError);
      expect(String(failure)).not.toContain(sentinel);
      expect(chunks).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a directory with no captures", async () => {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-capture-empty-"));
    try {
      await expect(printRejectedAuthorCaptureReport(root, collectingIo().io)).rejects.toThrow(
        /no rejected-author-\* captures/u,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("is a CliUserError, so the top-level formatter prints the message verbatim", () => {
    expect(new CaptureReportUserError("message")).toBeInstanceOf(CliUserError);
  });
});
