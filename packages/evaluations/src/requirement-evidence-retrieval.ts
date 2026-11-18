import type { ScoredEvidenceChunk } from "@draft-loop/domain";
import type { SemanticRelevanceFloor, TextEmbedder } from "@draft-loop/embeddings";

import { createHybridRetriever } from "./retrieval.js";
import { createSemanticRetriever } from "./semantic-retrieval.js";

/*
 * Requirement-to-evidence retrieval evaluation (#2980). For every job requirement, each arm
 * returns at most `requirementEvidenceLimit` chunks, and the arm is scored on how many of the
 * requirement's labelled supporting chunks it found. It gates the requirement-evidence map
 * (#2987): the map goes ahead only if hybrid or semantic recall reaches the gate.
 */

/** Chunks each arm may return per requirement; today's requirement-picked fallback keeps eight. */
export const requirementEvidenceLimit = 8;

/** Mean recall a map arm must reach on the fixture for the map work to continue. */
export const requirementEvidenceRecallGate = 0.85;

export type RequirementEvidenceKind =
  | "paraphrase"
  | "synonym"
  | "cross-language"
  | "exact"
  | "keyword-trap";

export interface RequirementEvidenceFixture {
  readonly corpus: readonly {
    readonly id: string;
    readonly language: string;
    readonly text: string;
  }[];
  readonly cases: readonly {
    readonly id: string;
    readonly kind: RequirementEvidenceKind;
    readonly requirement: string;
    readonly groundTruthEvidenceIds: readonly string[];
  }[];
}

/** Returns at most `limit` chunks for one requirement, best first. */
export type RequirementEvidenceArm = (
  requirement: string,
  limit: number,
) => Promise<readonly ScoredEvidenceChunk[]>;

export interface RequirementEvidenceMetrics {
  /** Mean share of each requirement's labelled chunks that the arm returned. */
  readonly recall: number;
  /** Mean reciprocal rank of the first labelled chunk; zero when none was returned. */
  readonly meanReciprocalRank: number;
  /** Share of requirements for which the arm found at least one labelled chunk. */
  readonly anyHit: number;
  /**
   * Mean share of each requirement's first R chunks that are labelled, where R is its number of
   * labelled chunks: how well the arm ranks what it finds, independent of the limit.
   */
  readonly rPrecision: number;
  readonly recallByKind: Readonly<Partial<Record<RequirementEvidenceKind, number>>>;
}

/** Content-free per-requirement result: ids and numbers only, never requirement or chunk text. */
export interface RequirementEvidenceCaseResult {
  readonly id: string;
  readonly kind: RequirementEvidenceKind;
  readonly found: number;
  readonly expected: number;
}

export interface RequirementEvidenceArmReport {
  readonly metrics: RequirementEvidenceMetrics;
  readonly cases: readonly RequirementEvidenceCaseResult[];
}

/** Scores one arm over every requirement of the fixture. */
export async function scoreRequirementEvidenceArm(
  fixture: RequirementEvidenceFixture,
  arm: RequirementEvidenceArm,
  limit = requirementEvidenceLimit,
): Promise<RequirementEvidenceArmReport> {
  const results: RequirementEvidenceCaseResult[] = [];
  let recallTotal = 0;
  let reciprocalTotal = 0;
  let anyHitTotal = 0;
  let rPrecisionTotal = 0;
  const byKind = new Map<RequirementEvidenceKind, { total: number; count: number }>();
  for (const benchmarkCase of fixture.cases) {
    const returned = (await arm(benchmarkCase.requirement, limit)).slice(0, limit);
    const expected = new Set(benchmarkCase.groundTruthEvidenceIds);
    const found = returned.filter((chunk) => expected.has(chunk.id)).length;
    const firstHit = returned.findIndex((chunk) => expected.has(chunk.id));
    const recall = expected.size === 0 ? 1 : found / expected.size;
    recallTotal += recall;
    reciprocalTotal += firstHit === -1 ? 0 : 1 / (firstHit + 1);
    anyHitTotal += found > 0 ? 1 : 0;
    rPrecisionTotal +=
      expected.size === 0
        ? 1
        : returned.slice(0, expected.size).filter((chunk) => expected.has(chunk.id)).length /
          expected.size;
    const kind = byKind.get(benchmarkCase.kind) ?? { total: 0, count: 0 };
    byKind.set(benchmarkCase.kind, { total: kind.total + recall, count: kind.count + 1 });
    results.push({
      id: benchmarkCase.id,
      kind: benchmarkCase.kind,
      found,
      expected: expected.size,
    });
  }
  const n = Math.max(1, fixture.cases.length);
  return {
    metrics: {
      recall: recallTotal / n,
      meanReciprocalRank: reciprocalTotal / n,
      anyHit: anyHitTotal / n,
      rPrecision: rPrecisionTotal / n,
      recallByKind: Object.fromEntries(
        [...byKind].map(([kind, { total, count }]) => [kind, total / count]),
      ),
    },
    cases: results,
  };
}

/** The fixture's chunks as scored evidence, in fixture order. */
export function requirementEvidenceCorpus(
  fixture: RequirementEvidenceFixture,
  base: Omit<ScoredEvidenceChunk, "id" | "text" | "rank" | "ordinal" | "lineStart" | "lineEnd">,
): readonly ScoredEvidenceChunk[] {
  return fixture.corpus.map((entry, ordinal) => ({
    ...base,
    id: entry.id,
    text: entry.text,
    ordinal,
    lineStart: ordinal + 1,
    lineEnd: ordinal + 1,
    rank: 0,
  }));
}

export interface RequirementEvidenceComparisonInput {
  readonly fixture: RequirementEvidenceFixture;
  readonly corpus: readonly ScoredEvidenceChunk[];
  /** Today's requirement-picked fallback, run for one requirement at a time. */
  readonly picks: RequirementEvidenceArm;
  /** BM25 over the same chunks, already scoped to the workspace that holds them. */
  readonly lexical: RequirementEvidenceArm;
  /** With an embedder, the semantic and hybrid arms run too. */
  readonly embedder?: TextEmbedder;
  readonly relevanceFloor?: SemanticRelevanceFloor;
  /**
   * With a cross-encoder (#3020), two rerank arms run too: the floored semantic candidates
   * reordered by it, and a wider semantic pool without the floor cut back to the limit by it.
   */
  readonly rerank?: RequirementEvidenceReranker;
  readonly limit?: number;
}

/** Scores each passage against the requirement; higher is more relevant. */
export type RequirementEvidenceReranker = (
  requirement: string,
  passages: readonly string[],
) => Promise<readonly number[]>;

/** Semantic candidates the wide rerank arm reads before cutting back to the limit. */
export const requirementEvidenceRerankPool = 24;

async function reranked(
  rerank: RequirementEvidenceReranker,
  requirement: string,
  candidates: readonly ScoredEvidenceChunk[],
  limit: number,
): Promise<readonly ScoredEvidenceChunk[]> {
  if (candidates.length === 0) return [];
  const scores = await rerank(
    requirement,
    candidates.map((chunk) => chunk.text),
  );
  return candidates
    .map((chunk, index) => ({ chunk, score: scores[index] ?? Number.NEGATIVE_INFINITY, index }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit)
    .map(({ chunk }) => chunk);
}

export interface RequirementEvidenceComparisonReport {
  readonly limit: number;
  readonly caseCount: number;
  readonly chunkCount: number;
  readonly gate: number;
  readonly arms: {
    readonly picks: RequirementEvidenceArmReport;
    readonly bm25: RequirementEvidenceArmReport;
    readonly semantic?: RequirementEvidenceArmReport;
    readonly hybrid?: RequirementEvidenceArmReport;
    /** The floored semantic candidates, reordered by the cross-encoder. */
    readonly semanticReranked?: RequirementEvidenceArmReport;
    /** A wider semantic pool without the floor, cut back to the limit by the cross-encoder. */
    readonly wideReranked?: RequirementEvidenceArmReport;
  };
  /** True when the semantic or hybrid arm reached the gate; null without an embedder. */
  readonly passesGate: boolean | null;
}

/** Runs every available arm over the fixture and reports content-free metrics. */
export async function runRequirementEvidenceComparison(
  input: RequirementEvidenceComparisonInput,
): Promise<RequirementEvidenceComparisonReport> {
  const limit = input.limit ?? requirementEvidenceLimit;
  const picks = await scoreRequirementEvidenceArm(input.fixture, input.picks, limit);
  const bm25 = await scoreRequirementEvidenceArm(input.fixture, input.lexical, limit);
  const base = {
    limit,
    caseCount: input.fixture.cases.length,
    chunkCount: input.corpus.length,
    gate: requirementEvidenceRecallGate,
  };
  if (input.embedder === undefined) {
    return { ...base, arms: { picks, bm25 }, passesGate: null };
  }
  const semanticRetriever = await createSemanticRetriever(input.embedder, input.corpus, {
    ...(input.relevanceFloor === undefined ? {} : { relevanceFloor: input.relevanceFloor }),
  });
  const lexicalPort = {
    queryEvidence: (query: string, options?: { readonly limit?: number }) =>
      input.lexical(query, options?.limit ?? limit),
  };
  const hybridPort = createHybridRetriever(lexicalPort, semanticRetriever);
  const semantic = await scoreRequirementEvidenceArm(
    input.fixture,
    (requirement, armLimit) => semanticRetriever.queryEvidence(requirement, { limit: armLimit }),
    limit,
  );
  const hybrid = await scoreRequirementEvidenceArm(
    input.fixture,
    (requirement, armLimit) => hybridPort.queryEvidence(requirement, { limit: armLimit }),
    limit,
  );
  const passesGate = Math.max(semantic.metrics.recall, hybrid.metrics.recall) >= base.gate;
  if (input.rerank === undefined) {
    return { ...base, arms: { picks, bm25, semantic, hybrid }, passesGate };
  }
  const rerank = input.rerank;
  const wideRetriever = await createSemanticRetriever(input.embedder, input.corpus, {});
  const semanticReranked = await scoreRequirementEvidenceArm(
    input.fixture,
    async (requirement, armLimit) =>
      reranked(
        rerank,
        requirement,
        await semanticRetriever.queryEvidence(requirement, { limit: armLimit }),
        armLimit,
      ),
    limit,
  );
  const wideReranked = await scoreRequirementEvidenceArm(
    input.fixture,
    async (requirement, armLimit) =>
      reranked(
        rerank,
        requirement,
        await wideRetriever.queryEvidence(requirement, {
          limit: Math.max(armLimit, requirementEvidenceRerankPool),
        }),
        armLimit,
      ),
    limit,
  );
  return {
    ...base,
    arms: { picks, bm25, semantic, hybrid, semanticReranked, wideReranked },
    passesGate,
  };
}
