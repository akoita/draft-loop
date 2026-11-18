import type { ScoredEvidenceChunk } from "@draft-loop/domain";
import type { CrossEncoder } from "@draft-loop/embeddings";
import { describe, expect, it } from "vitest";

import {
  type RequirementEvidenceMap,
  requirementEvidenceMapAuditPayload,
  requirementEvidenceMapPreflightLine,
} from "./requirement-evidence-map.js";
import {
  openRunCrossEncoder,
  requirementEvidenceRerankEnabled,
  rerankRequirementEvidenceMap,
} from "./requirement-evidence-rerank.js";
import { withRequirementEvidenceMap } from "./run-requirement-evidence-map.js";

const chunk = (id: string, text: string) =>
  ({ id, sourceId: "source-1", text, lineStart: 1, lineEnd: 2 }) as unknown as ScoredEvidenceChunk;

/** Invented evidence for one invented requirement. */
const eligible = [
  chunk("a", "Attended an invented meetup."),
  chunk("b", "Led a fictional platform team of six."),
  chunk("c", "Wrote the on-call guide for a synthetic service."),
];
const requirements = [
  { id: "r-lead", text: "Team leadership" },
  { id: "r-empty", text: "Unmatched requirement" },
];

const map: RequirementEvidenceMap = Object.freeze({
  mode: "semantic",
  modelId: "fake-embedder",
  chunkCount: 3,
  entries: [
    {
      requirementId: "r-lead",
      candidates: [
        { chunkId: "a", score: 0.9, origin: "semantic" as const },
        { chunkId: "b", score: 0.88, origin: "both" as const },
        { chunkId: "c", origin: "keyword" as const },
      ],
    },
    { requirementId: "r-empty", candidates: [] },
  ],
});

function fakeEncoder(scores: Readonly<Record<string, number>>, fail = false): CrossEncoder {
  return {
    identity: {
      modelId: "fake-reranker",
      sourceRepository: "invented/fake",
      revision: "0",
      modelFileSha256: "0",
      runtime: "fake",
    },
    score: async (_query, passages) => {
      if (fail) throw new Error("invented failure");
      return passages.map((text) => scores[text] ?? 0);
    },
    dispose: async () => undefined,
  };
}

const clock = () => {
  let time = 0;
  return () => {
    time += 250;
    return time;
  };
};

describe("requirement-evidence rerank", () => {
  it("is off unless the setting says on", () => {
    expect(requirementEvidenceRerankEnabled({})).toBe(false);
    expect(requirementEvidenceRerankEnabled({ DRAFT_LOOP_EVIDENCE_RERANK: "off" })).toBe(false);
    expect(requirementEvidenceRerankEnabled({ DRAFT_LOOP_EVIDENCE_RERANK: " On " })).toBe(true);
  });

  it("reorders candidates by cross-encoder score and keeps every one", async () => {
    const reranked = await rerankRequirementEvidenceMap({
      map,
      requirements,
      eligible,
      encoder: fakeEncoder({
        [eligible[0]?.text ?? ""]: 0.01,
        [eligible[1]?.text ?? ""]: 0.2,
        [eligible[2]?.text ?? ""]: 0.05,
      }),
      now: clock(),
    });
    expect(reranked.entries[0]?.candidates.map(({ chunkId }) => chunkId)).toEqual(["b", "c", "a"]);
    expect(reranked.entries[0]?.candidates[0]).toEqual({
      chunkId: "b",
      score: 0.88,
      origin: "both",
    });
    expect(reranked.entries[1]?.candidates).toEqual([]);
    expect(reranked.rerank).toEqual({
      status: "reranked",
      modelId: "fake-reranker",
      durationMs: 250,
      pairCount: 3,
    });
    expect(requirementEvidenceMapPreflightLine(reranked)).toBe(
      "Requirement evidence: 1 of 2 requirements matched by meaning and keywords, reordered by the local reranker in 0.3 s",
    );
    expect(requirementEvidenceMapAuditPayload(reranked, eligible).rerank).toEqual(reranked.rerank);
  });

  it("keeps the map's order when the encoder fails or is missing", async () => {
    const failed = await rerankRequirementEvidenceMap({
      map,
      requirements,
      eligible,
      encoder: fakeEncoder({}, true),
      now: clock(),
    });
    expect(failed.entries).toEqual(map.entries);
    expect(failed.rerank?.status).toBe("failed");
    expect(requirementEvidenceMapPreflightLine(failed)).toContain(
      "not reordered (the local reranker failed)",
    );

    const missing = await rerankRequirementEvidenceMap({
      map,
      requirements,
      eligible,
      encoder: undefined,
    });
    expect(missing.entries).toEqual(map.entries);
    expect(missing.rerank).toEqual({ status: "no-model", durationMs: 0, pairCount: 0 });
  });

  it("opens no encoder without a model directory, and none when the open fails", async () => {
    await expect(openRunCrossEncoder({ modelDirectory: "" })).resolves.toBeUndefined();
    await expect(
      openRunCrossEncoder({
        modelDirectory: "/invented/reranker",
        open: async () => {
          throw new Error("missing files");
        },
      }),
    ).resolves.toBeUndefined();
  });
});

describe("withRequirementEvidenceMap with rerank", () => {
  it("reorders the run's map when asked, and leaves it alone otherwise", async () => {
    const runtime = { fullSourceEvidence: async () => eligible };
    const context = { requirements: [{ id: "r-lead", text: "Team leadership" }] } as never;
    const encoder = fakeEncoder({ [eligible[2]?.text ?? ""]: 0.9 });
    const base = { tier: "311m" as const, modelRoot: "/invented/no-models" };
    const plain = await withRequirementEvidenceMap(runtime, context, {
      ...base,
      rerank: false,
      openCrossEncoder: async () => encoder,
    }).requirementEvidenceMap();
    expect(plain?.rerank).toBeUndefined();
    const reranked = await withRequirementEvidenceMap(runtime, context, {
      ...base,
      rerank: true,
      openCrossEncoder: async () => encoder,
    }).requirementEvidenceMap();
    expect(reranked?.rerank?.status).toBe("reranked");
  });
});
