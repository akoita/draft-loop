import { createHash, randomUUID } from "node:crypto";

import type {
  CandidateKnowledgeLexicalHit,
  CandidateKnowledgeRetrievalSourceVersionReference,
  CandidateKnowledgeRetrievalStatus,
  ContextSnapshot,
  RetrievalPort,
  ScoredEvidenceChunk,
} from "@draft-loop/domain";
import type { SqliteStorage } from "@draft-loop/storage";
import type {
  CandidateKnowledgeRetrievalDiagnostic,
  CandidateKnowledgeRetrievalResult,
} from "./knowledge-base.js";
import { createCandidateKnowledgeStoreService } from "./knowledge-base.js";
import {
  hasRequiredSectionEvidence,
  mergeRequiredSectionEvidence,
  type RequiredSectionRetrievalResult,
  type RequiredSectionSupplement,
  requiredSectionQueries,
} from "./required-section-evidence.js";
import { timestamp } from "./response-execution.js";

export interface CandidateKnowledgeRuntimeConfig {
  readonly id: string;
  readonly requiredSections: readonly string[];
  readonly candidateKnowledgeSelection?: {
    readonly entries: readonly {
      readonly storeRoot: string;
      readonly knowledgeBaseId: string;
    }[];
    readonly combinationApproved?: boolean;
  };
}

const requiredSectionRetrievalLimit = 4;

function candidateKnowledgeEvidenceIdentity(
  reference: CandidateKnowledgeRetrievalSourceVersionReference,
): string {
  return JSON.stringify([
    reference.storeId,
    reference.knowledgeBaseId,
    reference.sourceId,
    reference.versionId,
  ]);
}

export function candidateKnowledgeEvidenceSourceId(
  reference: CandidateKnowledgeRetrievalSourceVersionReference,
): string {
  return `ckb-source-${createHash("sha256")
    .update(candidateKnowledgeEvidenceIdentity(reference), "utf8")
    .digest("hex")
    .slice(0, 32)}`;
}

export function candidateKnowledgeEvidenceChecksum(
  reference: CandidateKnowledgeRetrievalSourceVersionReference,
): string {
  return createHash("sha256")
    .update(
      `candidate-knowledge-version\u0000${candidateKnowledgeEvidenceIdentity(reference)}`,
      "utf8",
    )
    .digest("hex");
}

function scopeKey(value: { readonly storeId: string; readonly knowledgeBaseId: string }): string {
  return JSON.stringify([value.storeId, value.knowledgeBaseId]);
}

function provenanceKey(hit: CandidateKnowledgeLexicalHit): string {
  return scopeKey(hit.metadata.provenance);
}

function aggregateStatus(
  statuses: readonly CandidateKnowledgeRetrievalStatus[],
  hitCount: number,
): CandidateKnowledgeRetrievalStatus {
  if (hitCount > 0) return statuses.includes("matched") ? "matched" : "bounded-fallback";
  if (statuses.includes("not-indexed")) return "not-indexed";
  if (statuses.includes("stale")) return "stale";
  if (statuses.includes("bounded-fallback")) return "bounded-fallback";
  if (statuses.length > 0 && statuses.every((status) => status === "no-query")) return "no-query";
  return "matched";
}

function toScoredEvidenceChunk(
  hit: CandidateKnowledgeLexicalHit,
  workspaceId: string,
): ScoredEvidenceChunk {
  return {
    id: hit.chunkId,
    workspaceId,
    sourceId: candidateKnowledgeEvidenceSourceId(hit.metadata.provenance),
    ordinal: hit.ordinal,
    lineStart: hit.lineStart,
    lineEnd: hit.lineEnd,
    checksum: candidateKnowledgeEvidenceChecksum(hit.metadata.provenance),
    text: hit.text,
    rank: hit.bm25Rank,
  };
}

function mergeDiagnostics(
  results: readonly CandidateKnowledgeRetrievalResult[],
  hits: readonly CandidateKnowledgeLexicalHit[],
): readonly CandidateKnowledgeRetrievalDiagnostic[] {
  const groups = new Map<
    string,
    {
      readonly diagnostics: CandidateKnowledgeRetrievalDiagnostic[];
    }
  >();
  for (const result of results) {
    for (const diagnostic of result.diagnostics) {
      const key = scopeKey(diagnostic);
      const group = groups.get(key);
      if (group === undefined) {
        groups.set(key, { diagnostics: [diagnostic] });
      } else {
        group.diagnostics.push(diagnostic);
      }
    }
  }

  return Object.freeze(
    [...groups.entries()]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, group]) => {
        const first = group.diagnostics[0];
        if (first === undefined) throw new Error("Candidate retrieval diagnostics are incomplete.");
        const scopeHits = hits.filter((hit) => provenanceKey(hit) === key);
        const selectedChunks = [...scopeHits]
          .sort(
            (left, right) =>
              left.bm25Rank - right.bm25Rank || left.chunkId.localeCompare(right.chunkId),
          )
          .map(({ chunkId, bm25Rank }) => ({ chunkId, bm25Rank }));
        const statuses = group.diagnostics.map(({ status }) => status);
        return Object.freeze({
          storeId: first.storeId,
          knowledgeBaseId: first.knowledgeBaseId,
          scope: first.scope,
          status: aggregateStatus(statuses, selectedChunks.length),
          indexedChunkCount: Math.max(
            ...group.diagnostics.map(({ indexedChunkCount }) => indexedChunkCount),
          ),
          selectedChunkCount: selectedChunks.length,
          selectedSourceCount: new Set(
            scopeHits.map((hit) => JSON.stringify(hit.metadata.provenance)),
          ).size,
          index: group.diagnostics.find(({ index }) => index !== null)?.index ?? null,
          selectedChunks: Object.freeze(selectedChunks),
        });
      }),
  );
}

/**
 * Build the runtime retrieval port for a pinned candidate-knowledge selection.
 * Each request keeps a bounded primary result and reserves one matched chunk
 * for each configured required section before provider handoff.
 */
export function candidateKnowledgeRuntimeRetrieval(
  storage: Pick<SqliteStorage, "appendCandidateKnowledgeRetrievalTrace">,
  config: CandidateKnowledgeRuntimeConfig,
  context: ContextSnapshot,
):
  | {
      readonly port: RetrievalPort;
      readonly inspect: (query: string) => Promise<CandidateKnowledgeRetrievalResult>;
    }
  | undefined {
  const binding = config.candidateKnowledgeSelection;
  const selection = context.candidateKnowledgeSelection;
  if (binding === undefined || selection === undefined) return undefined;

  const service = createCandidateKnowledgeStoreService();
  const rawCache = new Map<string, Promise<CandidateKnowledgeRetrievalResult>>();
  const combinedCache = new Map<string, Promise<CandidateKnowledgeRetrievalResult>>();
  const rawQuery = (text: string, limit: number): Promise<CandidateKnowledgeRetrievalResult> => {
    const key = JSON.stringify([text, limit]);
    const existing = rawCache.get(key);
    if (existing !== undefined) return existing;
    const pending = (async () => {
      const startedAt = Date.now();
      const operationId = `ckb-retrieval-${randomUUID()}`;
      const result = await service.queryCandidateKnowledge({
        selections: binding.entries.map(({ storeRoot, knowledgeBaseId }) => ({
          storeRoot,
          knowledgeBaseId,
        })),
        ...(binding.combinationApproved === undefined
          ? {}
          : { combinationApproved: binding.combinationApproved }),
        purpose: "achievement-recall",
        query: text,
        limit,
      });
      const createdAt = timestamp();
      const queryChecksum = createHash("sha256").update(text, "utf8").digest("hex");
      const latencyMs = Math.max(0, Date.now() - startedAt);
      for (const diagnostic of result.diagnostics) {
        await storage.appendCandidateKnowledgeRetrievalTrace({
          id: `trace-${randomUUID()}`,
          workspaceId: config.id,
          operationId,
          purpose: "achievement-recall",
          queryChecksum,
          scope: diagnostic.scope,
          index: diagnostic.index,
          status: diagnostic.status,
          indexedChunkCount: diagnostic.indexedChunkCount,
          selectedChunkCount: diagnostic.selectedChunkCount,
          selectedSourceCount: diagnostic.selectedSourceCount,
          latencyMs,
          selectedChunks: diagnostic.selectedChunks,
          createdAt,
        });
      }
      return result;
    })();
    rawCache.set(key, pending);
    return pending;
  };

  const query = (text: string, limit = 20): Promise<CandidateKnowledgeRetrievalResult> => {
    const key = JSON.stringify([text, limit]);
    const existing = combinedCache.get(key);
    if (existing !== undefined) return existing;
    const pending = (async () => {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) {
        return rawQuery(text, limit);
      }
      const sectionQueries = requiredSectionQueries(config.requiredSections, limit);
      const primaryLimit = Math.max(1, limit - sectionQueries.length);
      const primary = await rawQuery(text, primaryLimit);
      const supplements: RequiredSectionSupplement[] = [];
      const rawSupplementResults: CandidateKnowledgeRetrievalResult[] = [];
      for (const sectionQuery of sectionQueries) {
        const result = await rawQuery(sectionQuery.query, requiredSectionRetrievalLimit);
        rawSupplementResults.push(result);
        const sectionResult: RequiredSectionRetrievalResult = {
          status: result.status,
          hits: result.hits.map((hit) => toScoredEvidenceChunk(hit, config.id)),
        };
        if (
          result.status === "matched" &&
          result.hits.length >= requiredSectionRetrievalLimit &&
          !hasRequiredSectionEvidence(sectionQuery.section, [
            ...primary.hits.map((hit) => toScoredEvidenceChunk(hit, config.id)),
            ...sectionResult.hits,
          ])
        ) {
          throw new Error(
            "Required-section evidence coverage could not be established within the retrieval limit.",
          );
        }
        supplements.push({ section: sectionQuery.section, result: sectionResult });
      }

      const primaryHits = primary.hits.map((hit) => toScoredEvidenceChunk(hit, config.id));
      const hits = mergeRequiredSectionEvidence(
        { status: primary.status, hits: primaryHits },
        supplements,
        limit,
      );
      const selectedIds = new Set(hits.map((hit) => hit.id));
      const rawHitsById = new Map<string, CandidateKnowledgeLexicalHit>(
        [primary, ...rawSupplementResults]
          .flatMap(({ hits: rawHits }) => rawHits)
          .filter((hit) => selectedIds.has(hit.chunkId))
          .map((hit) => [hit.chunkId, hit] as const),
      );
      const selectedRawHits = hits.flatMap((hit) => {
        const rawHit = rawHitsById.get(hit.id);
        return rawHit === undefined ? [] : [rawHit];
      });
      const result: CandidateKnowledgeRetrievalResult = {
        status: aggregateStatus(
          [primary.status, ...supplements.map(({ result: sectionResult }) => sectionResult.status)],
          hits.length,
        ),
        indexedChunkCount: primary.indexedChunkCount,
        selectedChunkCount: hits.length,
        selectedSourceCount: new Set(
          selectedRawHits.map((hit) => JSON.stringify(hit.metadata.provenance)),
        ).size,
        hits: Object.freeze(selectedRawHits),
        diagnostics: mergeDiagnostics([primary, ...rawSupplementResults], selectedRawHits),
      };
      return Object.freeze(result);
    })();
    combinedCache.set(key, pending);
    return pending;
  };

  return {
    inspect: (text) => query(text),
    port: {
      queryEvidence: async (text, options) => {
        const result = await query(text, options?.limit);
        return result.hits.map((hit) => toScoredEvidenceChunk(hit, config.id));
      },
    },
  };
}
