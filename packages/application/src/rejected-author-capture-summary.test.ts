import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { JsonObject, ModelResponse } from "@draft-loop/providers";
import { describe, expect, it } from "vitest";

import { buildAuthorArtifactWithCapture } from "./rejected-author-capture.js";
import {
  RejectedAuthorCaptureSummaryInputError,
  summarizeRejectedAuthorCaptures,
} from "./rejected-author-capture-summary.js";
import { replayRejectedAuthorCapture } from "./rejected-author-replay.js";

const sentinel = "SENTINELZQX";
const privatePath = `/private/${sentinel}/resume.md`;
const evidenceText = `Built reliable TypeScript tools at ${sentinel}.`;

interface SectionInput {
  readonly kind: string;
  readonly text: string;
  readonly claimText?: string;
}

function section({ kind, text, claimText = text }: SectionInput) {
  return {
    title: `Title ${sentinel}`,
    kind,
    blocks: [
      {
        type: "paragraph",
        text,
        claims: [{ text: claimText, substantive: true, evidenceChunkIds: ["chunk-1"] }],
      },
    ],
  };
}

function capture(sections: readonly SectionInput[]) {
  return {
    schemaVersion: 1,
    capturedAt: "2026-09-19T15:00:00.000Z",
    provider: "anthropic",
    modelId: `model-${sentinel}`,
    validationInputs: {
      proposal: { sections: sections.map(section) },
      executionId: `execution-${sentinel}`,
      context: {
        language: "en",
        evidenceManifest: [{ id: "source-1", path: privatePath, checksum: "a".repeat(64) }],
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
      createdAt: "2026-09-19T15:00:00.000Z",
    },
    failureStage: "factual-invariant-rejection",
    diagnostics: [],
  };
}

const grounded: SectionInput = { kind: "summary", text: evidenceText };
const inventedMetric = `Built 999 reliable TypeScript tools at ${sentinel}.`;
const uncovered = (kind: string): SectionInput => ({
  kind,
  text: `Built tools across ${sentinel} regulated industries.`,
  claimText: "Built tools",
});

describe("rejected author capture summary", () => {
  it("counts every issue by code and section kind without returning content", () => {
    const summary = summarizeRejectedAuthorCaptures([
      capture([grounded]),
      capture([{ kind: "summary", text: inventedMetric }, uncovered("experience")]),
      capture([uncovered("experience"), uncovered("skills")]),
      capture([grounded, { kind: `Unsafe ${sentinel}`, text: evidenceText }]),
    ]);

    expect(summary).toEqual({
      total: 4,
      accepted: 1,
      rejected: 3,
      captures: [
        { index: 0, accepted: true, issueTotal: 0, codeCounts: [], sectionCodeCounts: [] },
        {
          index: 1,
          accepted: false,
          issueTotal: 2,
          codeCounts: [
            { code: "factual_invariant_violation", count: 1 },
            { code: "substantive_text_uncovered", count: 1 },
          ],
          sectionCodeCounts: [
            { sectionKind: "experience", code: "substantive_text_uncovered", count: 1 },
            { sectionKind: "summary", code: "factual_invariant_violation", count: 1 },
          ],
        },
        {
          index: 2,
          accepted: false,
          issueTotal: 2,
          codeCounts: [{ code: "substantive_text_uncovered", count: 2 }],
          sectionCodeCounts: [
            { sectionKind: "experience", code: "substantive_text_uncovered", count: 1 },
            { sectionKind: "skills", code: "substantive_text_uncovered", count: 1 },
          ],
        },
        {
          // An unsafe section kind fails the proposal schema; its issue is
          // attributed to the sanitized kind rather than the raw value.
          index: 3,
          accepted: false,
          issueTotal: 1,
          codeCounts: [{ code: "invalid_value", count: 1 }],
          sectionCodeCounts: [{ sectionKind: "other", code: "invalid_value", count: 1 }],
        },
      ],
      codeCounts: [
        { code: "substantive_text_uncovered", count: 3 },
        { code: "factual_invariant_violation", count: 1 },
        { code: "invalid_value", count: 1 },
      ],
      sectionCodeCounts: [
        { sectionKind: "experience", code: "substantive_text_uncovered", count: 2 },
        { sectionKind: "other", code: "invalid_value", count: 1 },
        { sectionKind: "skills", code: "substantive_text_uncovered", count: 1 },
        { sectionKind: "summary", code: "factual_invariant_violation", count: 1 },
      ],
    });

    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain(sentinel);
    expect(serialized).not.toContain("999");
    expect(serialized).not.toContain("Unsafe");
    expect(serialized).not.toContain("anthropic");
    expect(serialized).not.toContain("2026");
  });

  it("uses the none kind for issues outside any section", () => {
    const blankExecution = capture([grounded]);
    blankExecution.validationInputs.executionId = " ";
    expect(summarizeRejectedAuthorCaptures([blankExecution]).sectionCodeCounts).toEqual([
      { sectionKind: "none", code: "custom", count: 1 },
    ]);
  });

  it("accepts an empty list", () => {
    expect(summarizeRejectedAuthorCaptures([])).toEqual({
      total: 0,
      accepted: 0,
      rejected: 0,
      captures: [],
      codeCounts: [],
      sectionCodeCounts: [],
    });
  });

  it.each([
    undefined,
    null,
    {},
    sentinel,
    [{ unexpected: sentinel }],
    [{ ...capture([grounded]), extra: sentinel }],
  ])("rejects invalid input with a fixed error that echoes no content", (input) => {
    expect(() => summarizeRejectedAuthorCaptures(input)).toThrow(
      new RejectedAuthorCaptureSummaryInputError(),
    );
    try {
      summarizeRejectedAuthorCaptures(input);
    } catch (error) {
      expect(String(error)).not.toContain(sentinel);
      expect(JSON.stringify(error)).not.toContain(sentinel);
    }
  });

  it("replays and summarizes a capture exactly as the capture writer stores it", async () => {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-capture-round-trip-"));
    try {
      // The writer stores the full run-context snapshot, and manifest entries
      // carry a media type; validation reads only language and id/path/checksum.
      const context = {
        schemaVersion: 1,
        id: `context-${sentinel}`,
        workspaceId: `workspace-${sentinel}`,
        createdAt: "2026-09-19T15:00:00.000Z",
        language: "en",
        jobDescription: `Job description ${sentinel}`,
        requirements: [{ id: "req-1", text: `Requirement ${sentinel}`, priority: "critical" }],
        candidateInstructions: `Instructions ${sentinel}`,
        outputConstraints: { requiredSections: ["Summary"] },
        truthfulnessPolicy: { forbidInventedMetrics: true },
        readinessRubric: { relevance: 0.7 },
        modelConfiguration: { author: { provider: "anthropic", modelId: `model-${sentinel}` } },
        candidateKnowledgeSelection: { mode: "all" },
        evidenceManifest: [
          {
            id: "source-1",
            path: privatePath,
            checksum: "a".repeat(64),
            mediaType: "text/markdown",
          },
        ],
      };
      const response: ModelResponse<JsonObject> = {
        output: { sections: [section({ kind: "summary", text: inventedMetric })] },
        contextSnapshotId: "context",
        provider: "anthropic",
        company: "anthropic",
        modelId: `model-${sentinel}`,
        providerRequestId: null,
        structuredOutputSha256: "c".repeat(64),
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        cost: { estimatedUsd: null },
      };
      const { validationInputs } = capture([]);
      await expect(
        buildAuthorArtifactWithCapture(
          response,
          {
            executionId: validationInputs.executionId,
            context,
            retrievedEvidence: validationInputs.retrievedEvidence,
            createdAt: validationInputs.createdAt,
          },
          root,
        ),
      ).rejects.toMatchObject({
        diagnostics: expect.arrayContaining([{ code: "local_author_capture_saved", path: "" }]),
      });

      const [captureDirectory] = await readdir(root);
      const written: unknown = JSON.parse(
        await readFile(join(root, captureDirectory ?? "", "replay.json"), "utf8"),
      );
      expect(written).toMatchObject({
        validationInputs: {
          context: {
            jobDescription: context.jobDescription,
            candidateInstructions: context.candidateInstructions,
            evidenceManifest: context.evidenceManifest,
          },
        },
      });

      expect(replayRejectedAuthorCapture(written)).toMatchObject({
        status: "rejected",
        failureStage: "factual-invariant-rejection",
      });
      const summary = summarizeRejectedAuthorCaptures([written]);
      expect(summary).toEqual({
        total: 1,
        accepted: 0,
        rejected: 1,
        captures: [
          {
            index: 0,
            accepted: false,
            issueTotal: 1,
            codeCounts: [{ code: "factual_invariant_violation", count: 1 }],
            sectionCodeCounts: [
              { sectionKind: "summary", code: "factual_invariant_violation", count: 1 },
            ],
          },
        ],
        codeCounts: [{ code: "factual_invariant_violation", count: 1 }],
        sectionCodeCounts: [
          { sectionKind: "summary", code: "factual_invariant_violation", count: 1 },
        ],
      });
      const serialized = JSON.stringify(summary);
      expect(serialized).not.toContain(sentinel);
      expect(serialized).not.toContain("Job description");
      expect(serialized).not.toContain("Instructions");
      expect(serialized).not.toContain("text/markdown");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("still rejects unknown keys outside the context", () => {
    const extended = capture([grounded]);
    expect(() =>
      summarizeRejectedAuthorCaptures([
        { ...extended, validationInputs: { ...extended.validationInputs, extra: sentinel } },
      ]),
    ).toThrow(new RejectedAuthorCaptureSummaryInputError());
  });
});
