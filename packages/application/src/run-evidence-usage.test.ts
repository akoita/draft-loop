import type { ExecutionRecord } from "@draft-loop/orchestrator";
import { describe, expect, it } from "vitest";

import { runEvidenceUsage } from "./run-evidence-usage.js";

const context = {
  evidenceManifest: [
    { id: "src-cv", path: "evidence/cv.md", mediaType: "text/markdown", checksum: "a" },
    { id: "src-notes", path: "evidence/notes.md", mediaType: "text/markdown", checksum: "b" },
  ],
} as never;

function execution(overrides: Partial<ExecutionRecord>): ExecutionRecord {
  return {
    id: "run-1:round:1:author:attempt:1",
    runId: "run-1",
    contextSnapshotId: "ctx-1",
    round: 1,
    step: "author",
    status: "completed",
    provider: "anthropic",
    modelId: "claude-sonnet-5-5",
    providerRequestId: null,
    inputTokens: 1,
    outputTokens: 1,
    totalTokens: 2,
    estimatedUsd: null,
    completedAt: "2026-10-31T03:00:00.000Z",
    ...overrides,
  } as ExecutionRecord;
}

const draft = {
  claims: [
    { id: "c1", evidence: [{ sourcePath: "evidence/cv.md", locator: "line:12-13", excerpt: "x" }] },
    {
      id: "c2",
      evidence: [{ sourcePath: "evidence/notes.md", locator: "line:40-41", excerpt: "y" }],
    },
  ],
} as never;

describe("runEvidenceUsage", () => {
  it("reports each author call that recorded its retrieved evidence, in execution order", () => {
    const usage = runEvidenceUsage(
      {
        runId: "run-1",
        executionHistory: [
          execution({
            retrievedEvidence: [
              { sourceId: "src-cv", lineStart: 10, lineEnd: 14, rank: 1 },
              { sourceId: "src-cv", lineStart: 50, lineEnd: 55, rank: 2 },
            ],
            output: draft,
          }),
          execution({
            id: "run-1:round:1:critic:attempt:1",
            step: "critic",
            retrievedEvidence: [{ sourceId: "src-cv", lineStart: 10, lineEnd: 14, rank: 1 }],
            output: { findings: [] } as never,
          }),
          execution({
            id: "run-1:round:2:revision:attempt:1",
            round: 2,
            step: "revision",
            retrievedEvidence: [{ sourceId: "src-notes", lineStart: 38, lineEnd: 44, rank: 1 }],
            output: draft,
          }),
        ],
      },
      context,
    );
    expect(usage).toEqual({
      runId: "run-1",
      calls: [
        {
          executionId: "run-1:round:1:author:attempt:1",
          round: 1,
          step: "author",
          sent: 2,
          cited: 1,
          uncitedRanks: [2],
          claimsOutsideRetrieval: 1,
          claimsWithoutEvidence: 0,
        },
        {
          executionId: "run-1:round:2:revision:attempt:1",
          round: 2,
          step: "revision",
          sent: 1,
          cited: 1,
          uncitedRanks: [],
          claimsOutsideRetrieval: 1,
          claimsWithoutEvidence: 0,
        },
      ],
    });
  });

  it("leaves out failed calls and calls recorded without their retrieved evidence", () => {
    const usage = runEvidenceUsage(
      {
        runId: "run-2",
        executionHistory: [
          execution({ output: draft }),
          execution({
            id: "run-2:round:1:author:attempt:2",
            status: "failed",
            retrievedEvidence: [],
            errorCode: "timeout",
          }),
        ],
      },
      context,
    );
    expect(usage).toEqual({ runId: "run-2", calls: [] });
  });
});
