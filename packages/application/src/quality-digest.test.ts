import { describe, expect, it } from "vitest";

import { buildQualityDigest, type QualityDigestSpan } from "./quality-digest.js";

const agent = (
  runId: string,
  status: "ok" | "error",
  attributes: QualityDigestSpan["attributes"],
): QualityDigestSpan => ({ runId, name: "invoke_agent", status, attributes });

describe("the daily quality digest (#2916)", () => {
  it("counts attempts, groups failures by mechanism and summarises retrieval", () => {
    const outputLimit = {
      "draftloop.step": "author",
      "gen_ai.request.model": "economy-author",
      "error.type": "invalid-response",
      "draftloop.failure_reason": "max_tokens",
    } as const;
    const digest = buildQualityDigest({
      day: "2026-11-16",
      organisations: 2,
      spans: [
        agent("run-1", "error", { ...outputLimit, "draftloop.estimated_usd": 0.05 }),
        agent("run-2", "error", outputLimit),
        agent("run-3", "error", outputLimit),
        agent("run-4", "error", outputLimit),
        agent("run-1", "ok", {
          "draftloop.step": "author",
          "gen_ai.request.model": "economy-author",
          "draftloop.estimated_usd": 0.1,
        }),
        agent("run-1", "ok", {
          "draftloop.step": "revision",
          "gen_ai.request.model": "economy-author",
          "draftloop.revision.mode": "patch-fallback",
          "draftloop.revision.patch_rejection": "unknown-block",
        }),
        {
          runId: "run-1",
          name: "retrieve_evidence",
          status: "ok",
          attributes: { "draftloop.retrieved_chunks": 0 },
        },
        {
          runId: "run-2",
          name: "retrieve_evidence",
          status: "ok",
          attributes: { "draftloop.retrieved_chunks": 6, "draftloop.retrieved_sources": 1 },
        },
        {
          runId: "run-3",
          name: "retrieve_evidence",
          status: "ok",
          attributes: { "draftloop.retrieved_chunks": 8, "draftloop.retrieved_sources": 3 },
        },
        { runId: "run-1", name: "invoke_workflow", status: "ok", attributes: {} },
      ],
    });

    expect(digest).toEqual({
      day: "2026-11-16",
      organisations: 2,
      runs: 4,
      estimatedUsd: 0.15,
      attempts: [
        { step: "author", model: "economy-author", ok: 1, error: 4 },
        { step: "revision", model: "economy-author", ok: 1, error: 0 },
      ],
      failures: [
        {
          step: "author",
          model: "economy-author",
          errorType: "invalid-response",
          failureStage: null,
          failureReason: "max_tokens",
          count: 4,
          runIds: ["run-1", "run-2", "run-3"],
        },
      ],
      revisionModes: [{ code: "patch-fallback", count: 1 }],
      patchRejections: [{ code: "unknown-block", count: 1 }],
      retrieval: { calls: 3, empty: 1, singleSource: 1, medianChunks: 6 },
      quality: { runs: 0, ready: 0, estimatedUsd: 0, costPerReadyDraft: null, pairs: [] },
    });
  });

  it("is empty for a day without spans", () => {
    expect(buildQualityDigest({ day: "2026-11-16", organisations: 0, spans: [] })).toMatchObject({
      runs: 0,
      failures: [],
      retrieval: { calls: 0, empty: 0, singleSource: 0, medianChunks: 0 },
    });
  });
});
