import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import {
  createOnnxCrossEncoder,
  createOnnxTextEmbedder,
  type GraniteEmbeddingTier,
  graniteEmbeddingModels,
  semanticRelevanceFloorForIdentity,
} from "@draft-loop/embeddings";
import {
  type RequirementEvidenceArm,
  type RequirementEvidenceComparisonReport,
  type RequirementEvidenceFixture,
  requirementEvidenceCorpus,
  runRequirementEvidenceComparison,
} from "@draft-loop/evaluations";
import { openSqliteStorage } from "@draft-loop/storage";
import { describe, expect, it } from "vitest";

import { pickRequirementEvidence } from "./requirement-picked-evidence.js";

/**
 * Requirement-to-evidence retrieval evaluation (#2980), recorded in
 * docs/evaluation/requirement-evidence-retrieval.md. The picks and BM25 arms always run. The
 * semantic and hybrid arms run only with a local embedding model, as in the other model tests:
 *
 *   DRAFT_LOOP_EMBEDDING_MODEL_DIR   directory with the verified model files
 *   DRAFT_LOOP_EMBEDDING_TIER        "311m" (default here) or "97m"
 *   DRAFT_LOOP_RETRIEVAL_REPORT_PATH optional path for the content-free JSON report
 *   DRAFT_LOOP_RERANKER_MODEL_DIR    optional directory with the pinned cross-encoder (#3020),
 *                                    which adds the two rerank arms
 */
const modelDirectory = process.env.DRAFT_LOOP_EMBEDDING_MODEL_DIR;
const requestedTier = process.env.DRAFT_LOOP_EMBEDDING_TIER ?? "311m";
const tier = (
  requestedTier in graniteEmbeddingModels ? requestedTier : "311m"
) as GraniteEmbeddingTier;
const reportPath = process.env.DRAFT_LOOP_RETRIEVAL_REPORT_PATH;
const rerankerDirectory = process.env.DRAFT_LOOP_RERANKER_MODEL_DIR;
const timestamp = "2026-11-18T00:30:00.000Z";
const checksum = "c".repeat(64);
const workspaceId = "fictional-requirement-evidence";
const sourceId = "fictional-requirement-evidence-source";

const fixture = JSON.parse(
  readFileSync(
    new URL(
      "../../evaluations/fixtures/retrieval-quality/requirement-evidence-cases.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as RequirementEvidenceFixture;

const corpus = requirementEvidenceCorpus(fixture, { workspaceId, sourceId, checksum });

/** Today's fallback for one requirement: the chunks that share its rare words, in source order. */
const picks: RequirementEvidenceArm = async (requirement, limit) =>
  pickRequirementEvidence({
    eligible: corpus,
    selected: [],
    requirements: [requirement],
    budgetCharacters: Number.MAX_SAFE_INTEGER,
  }).slice(0, limit);

async function compare(
  options: Pick<
    Parameters<typeof runRequirementEvidenceComparison>[0],
    "embedder" | "relevanceFloor" | "rerank"
  >,
): Promise<RequirementEvidenceComparisonReport> {
  const storage = openSqliteStorage(":memory:");
  try {
    await storage.saveWorkspace({
      id: workspaceId,
      state: "collecting",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await storage.saveEvidenceSource({
      id: sourceId,
      workspaceId,
      path: "fixture://fictional/requirement-evidence",
      mediaType: "text/markdown",
      checksum,
      createdAt: timestamp,
    });
    for (const chunk of corpus) {
      const { rank: _rank, ...record } = chunk;
      await storage.saveEvidenceChunk({ ...record, createdAt: timestamp });
    }
    const lexical: RequirementEvidenceArm = (requirement, limit) =>
      storage.queryEvidence(requirement, { workspaceId, limit });
    return await runRequirementEvidenceComparison({ fixture, corpus, picks, lexical, ...options });
  } finally {
    await storage.close();
  }
}

describe("requirement-evidence fixture", () => {
  it("labels every requirement with existing chunks and keeps distractors unlabelled", () => {
    const ids = new Set(fixture.corpus.map(({ id }) => id));
    const labelled = new Set(fixture.cases.flatMap((entry) => entry.groundTruthEvidenceIds));
    for (const id of labelled) expect(ids.has(id)).toBe(true);
    expect(fixture.cases).toHaveLength(16);
    expect(ids.size - labelled.size).toBe(4);
  });

  it("records keyword recall for today's picks and for BM25", async () => {
    const report = await compare({});
    expect(report.passesGate).toBeNull();
    // Recorded in docs/evaluation/requirement-evidence-retrieval.md.
    expect({
      picks: round(report.arms.picks.metrics.recall),
      bm25: round(report.arms.bm25.metrics.recall),
    }).toEqual(KEYWORD_RECALL);
  });
});

describe.skipIf(modelDirectory === undefined || modelDirectory === "")(
  "real-model requirement-evidence retrieval",
  () => {
    it("compares picks, BM25, semantic and hybrid recall per requirement", async () => {
      const embedder = await createOnnxTextEmbedder({
        modelDirectory: modelDirectory as string,
        tier,
      });
      const crossEncoder =
        rerankerDirectory === undefined || rerankerDirectory === ""
          ? undefined
          : await createOnnxCrossEncoder({ modelDirectory: rerankerDirectory });
      try {
        const relevanceFloor = semanticRelevanceFloorForIdentity(embedder.identity);
        const report = await compare({
          embedder,
          ...(relevanceFloor === undefined ? {} : { relevanceFloor }),
          ...(crossEncoder === undefined
            ? {}
            : {
                rerank: (requirement: string, passages: readonly string[]) =>
                  crossEncoder.score(requirement, passages),
              }),
        });
        expect(report.arms.semantic).toBeDefined();
        expect(report.arms.hybrid).toBeDefined();
        if (crossEncoder !== undefined) expect(report.arms.wideReranked).toBeDefined();
        if (reportPath !== undefined) {
          mkdirSync(dirname(reportPath), { recursive: true });
          writeFileSync(
            reportPath,
            `${JSON.stringify(
              {
                tier,
                embeddingIdentity: embedder.identity,
                relevanceFloor: relevanceFloor ?? null,
                crossEncoder: crossEncoder?.identity ?? null,
                ...report,
              },
              null,
              2,
            )}\n`,
          );
        }
      } finally {
        await crossEncoder?.dispose();
        await embedder.dispose();
      }
    }, 600_000);
  },
);

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

const KEYWORD_RECALL = { picks: 0.563, bm25: 0.531 };
