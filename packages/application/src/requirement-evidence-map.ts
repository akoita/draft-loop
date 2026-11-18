import type { ScoredEvidenceChunk } from "@draft-loop/domain";
import {
  applySemanticRelevanceFloor,
  cosineSimilarity,
  type SemanticRelevanceFloor,
  semanticRelevanceFloorForIdentity,
  type TextEmbedder,
} from "@draft-loop/embeddings";
import type { JsonValue } from "@draft-loop/storage";

import { rankRequirementEvidence } from "./requirement-picked-evidence.js";

/*
 * Requirement-evidence map (#2981, rollup #2987): for each job requirement, the chunks of the
 * run's evidence that most likely support it, found before the writer starts. The offline
 * evaluation (#2980, docs/evaluation/requirement-evidence-retrieval.md) found semantic retrieval
 * ranks the right chunk best, so candidates are ranked by meaning first; keyword matches that
 * meaning missed are added after them. Without a local model the map is keyword-only and says so.
 * The map only proposes evidence: it changes nothing the writer or critic receives yet.
 */

/** Candidates kept per requirement; the evaluation measured recall at eight. */
export const requirementEvidenceMapLimit = 8;

const embeddingBatchSize = 32;

export type RequirementEvidenceOrigin = "semantic" | "keyword" | "both";

export interface RequirementEvidenceCandidate {
  readonly chunkId: string;
  /** Cosine similarity for a semantic match; absent for a keyword-only match. */
  readonly score?: number;
  readonly origin: RequirementEvidenceOrigin;
}

export interface RequirementEvidenceMapEntry {
  readonly requirementId: string;
  readonly candidates: readonly RequirementEvidenceCandidate[];
}

export type RequirementEvidenceMapUnavailableReason =
  | "no-model"
  | "uncalibrated-model"
  | "embedding-failed";

export interface RequirementEvidenceMap {
  readonly mode: "semantic" | "keyword";
  /** Why the map is keyword-only; absent for a semantic map. */
  readonly reason?: RequirementEvidenceMapUnavailableReason;
  readonly modelId?: string;
  readonly chunkCount: number;
  readonly entries: readonly RequirementEvidenceMapEntry[];
}

export interface BuildRequirementEvidenceMapRequest {
  readonly requirements: readonly { readonly id: string; readonly text: string }[];
  /** Every eligible chunk of the run, as full source would send them. */
  readonly eligible: readonly ScoredEvidenceChunk[];
  /** The local embedder, or why none could be opened. */
  readonly embedder?: TextEmbedder;
  readonly unavailableReason?: RequirementEvidenceMapUnavailableReason;
  /** Overrides the floor calibrated for the embedder; a test seam. */
  readonly floor?: SemanticRelevanceFloor;
  readonly limit?: number;
  readonly signal?: AbortSignal;
}

function isAbort(error: unknown, signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true || (error instanceof Error && error.name === "AbortError");
}

async function embedAll(
  embedder: TextEmbedder,
  texts: readonly string[],
  role: "document" | "query",
  signal: AbortSignal | undefined,
): Promise<Float32Array[]> {
  const vectors: Float32Array[] = [];
  for (let start = 0; start < texts.length; start += embeddingBatchSize) {
    const batch = texts.slice(start, start + embeddingBatchSize);
    vectors.push(
      ...(await embedder.embed(batch, role, signal === undefined ? undefined : { signal })),
    );
  }
  if (vectors.length !== texts.length) {
    throw new RangeError(`Embedder returned ${vectors.length} vectors for ${texts.length} texts.`);
  }
  return vectors;
}

function keywordEntries(
  request: BuildRequirementEvidenceMapRequest,
  limit: number,
): readonly RequirementEvidenceMapEntry[] {
  return request.requirements.map((requirement) => ({
    requirementId: requirement.id,
    candidates: rankRequirementEvidence(request.eligible, requirement.text)
      .slice(0, limit)
      .map((chunk) => ({ chunkId: chunk.id, origin: "keyword" as const })),
  }));
}

function keywordMap(
  request: BuildRequirementEvidenceMapRequest,
  limit: number,
  reason: RequirementEvidenceMapUnavailableReason,
): RequirementEvidenceMap {
  return Object.freeze({
    mode: "keyword",
    reason,
    chunkCount: request.eligible.length,
    entries: keywordEntries(request, limit),
  });
}

/**
 * Builds the map. Semantic candidates pass the model's calibrated relevance floor; keyword
 * candidates fill the remaining places, and a chunk found both ways is marked `both`. An embedder
 * failure falls back to the keyword map rather than failing the run; an abort is rethrown.
 */
export async function buildRequirementEvidenceMap(
  request: BuildRequirementEvidenceMapRequest,
): Promise<RequirementEvidenceMap> {
  const limit = request.limit ?? requirementEvidenceMapLimit;
  const { embedder } = request;
  if (embedder === undefined) {
    return keywordMap(request, limit, request.unavailableReason ?? "no-model");
  }
  const floor = request.floor ?? semanticRelevanceFloorForIdentity(embedder.identity);
  if (floor === undefined) return keywordMap(request, limit, "uncalibrated-model");
  if (request.eligible.length === 0 || request.requirements.length === 0) {
    return Object.freeze({
      mode: "semantic",
      modelId: embedder.identity.modelId,
      chunkCount: request.eligible.length,
      entries: keywordEntries(request, limit),
    });
  }

  let entries: readonly RequirementEvidenceMapEntry[];
  try {
    const chunkVectors = await embedAll(
      embedder,
      request.eligible.map(({ text }) => text),
      "document",
      request.signal,
    );
    const requirementVectors = await embedAll(
      embedder,
      request.requirements.map(({ text }) => text),
      "query",
      request.signal,
    );
    // A malformed vector (zero norm) throws here too, and falls back like any embedder failure.
    entries = semanticEntries(request, chunkVectors, requirementVectors, floor, limit);
  } catch (error) {
    if (isAbort(error, request.signal)) throw error;
    return keywordMap(request, limit, "embedding-failed");
  }

  return Object.freeze({
    mode: "semantic",
    modelId: embedder.identity.modelId,
    chunkCount: request.eligible.length,
    entries,
  });
}

function semanticEntries(
  request: BuildRequirementEvidenceMapRequest,
  chunkVectors: readonly Float32Array[],
  requirementVectors: readonly Float32Array[],
  floor: SemanticRelevanceFloor,
  limit: number,
): readonly RequirementEvidenceMapEntry[] {
  return request.requirements.map((requirement, index) => {
    const query = requirementVectors[index] as Float32Array;
    const scored = request.eligible
      .map((chunk, chunkIndex) => ({
        chunk,
        score: cosineSimilarity(query, chunkVectors[chunkIndex] as Float32Array),
      }))
      .sort(
        (left, right) => right.score - left.score || left.chunk.id.localeCompare(right.chunk.id),
      );
    const semantic = applySemanticRelevanceFloor(scored, floor).slice(0, limit);
    const keyword = rankRequirementEvidence(request.eligible, requirement.text).slice(0, limit);
    const keywordIds = new Set(keyword.map(({ id }) => id));
    const candidates: RequirementEvidenceCandidate[] = semantic.map(({ chunk, score }) => ({
      chunkId: chunk.id,
      score,
      origin: keywordIds.has(chunk.id) ? "both" : "semantic",
    }));
    const taken = new Set(candidates.map(({ chunkId }) => chunkId));
    for (const chunk of keyword) {
      if (candidates.length >= limit) break;
      if (taken.has(chunk.id)) continue;
      candidates.push({ chunkId: chunk.id, origin: "keyword" });
      taken.add(chunk.id);
    }
    return { requirementId: requirement.id, candidates };
  });
}

/** Content-free audit payload: ids, origins, rounded scores and counts, never text. */
export function requirementEvidenceMapAuditPayload(
  map: RequirementEvidenceMap,
  /** The map's chunks, so each candidate also records its source id and lines (#3009). */
  eligible: readonly ScoredEvidenceChunk[] = [],
): {
  readonly [key: string]: JsonValue;
} {
  const located = new Map(eligible.map((chunk) => [chunk.id, chunk]));
  return {
    mode: map.mode,
    ...(map.reason === undefined ? {} : { reason: map.reason }),
    ...(map.modelId === undefined ? {} : { modelId: map.modelId }),
    chunkCount: map.chunkCount,
    requirementCount: map.entries.length,
    requirementsWithEvidence: map.entries.filter(({ candidates }) => candidates.length > 0).length,
    entries: map.entries.map(({ requirementId, candidates }) => ({
      requirementId,
      candidates: candidates.map(({ chunkId, origin, score }) => {
        const chunk = located.get(chunkId);
        return {
          chunkId,
          origin,
          ...(score === undefined ? {} : { score: Math.round(score * 1000) / 1000 }),
          ...(chunk === undefined
            ? {}
            : { sourceId: chunk.sourceId, lineStart: chunk.lineStart, lineEnd: chunk.lineEnd }),
        };
      }),
    })),
  };
}

/** One preflight line, so the person sees whether the map used the local model. */
export function requirementEvidenceMapPreflightLine(map: RequirementEvidenceMap): string {
  const found = map.entries.filter(({ candidates }) => candidates.length > 0).length;
  const how =
    map.mode === "semantic"
      ? "by meaning and keywords"
      : `by keywords only (${
          map.reason === "uncalibrated-model"
            ? "the local model has no calibrated relevance floor"
            : map.reason === "embedding-failed"
              ? "the local model failed"
              : "no local model is installed"
        })`;
  return `Requirement evidence: ${found} of ${map.entries.length} requirements matched ${how}`;
}
