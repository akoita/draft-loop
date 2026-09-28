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
import {
  candidateContactEvidenceQuery,
  candidateContactEvidenceQueryLimit,
  selectCandidateContactEvidence,
} from "./candidate-contact-evidence.js";
import {
  composeCandidateExperienceBodyEvidence,
  createPinnedCandidateKnowledgeSourceChunkLoader,
} from "./candidate-experience-body-evidence.js";
import {
  assertCandidateKnowledgeProviderBounds,
  candidateKnowledgeChronologyQueries,
  candidateKnowledgeChronologyQueryLimit,
  requiresExperienceChronology,
  selectCandidateKnowledgeChronologyHits,
} from "./candidate-knowledge-chronology.js";
import { isLeadingMarkdownHeadingOnly } from "./candidate-knowledge-heading.js";
import {
  candidatePriorityEvidenceChunkLimit,
  candidatePriorityEvidenceQuery,
  candidatePriorityEvidenceQueryLimit,
  selectCandidatePriorityEvidence,
} from "./candidate-priority-evidence.js";
import {
  candidateProductionSkillsEvidenceQuery,
  candidateProductionSkillsEvidenceQueryLimit,
  selectCandidateProductionSkillsEvidence,
} from "./candidate-production-skills-evidence.js";
import { composeCandidateRequiredSectionBodyEvidence } from "./candidate-required-section-body-evidence.js";
import type {
  CandidateKnowledgeRetrievalDiagnostic,
  CandidateKnowledgeRetrievalResult,
} from "./knowledge-base.js";
import { createCandidateKnowledgeStoreService } from "./knowledge-base.js";
import {
  hasRequiredSectionEvidence,
  isSkillsRequiredSection,
  matchesRequiredSectionHeading,
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
  const loadPinnedSourceChunks = createPinnedCandidateKnowledgeSourceChunkLoader(
    binding.entries,
    selection,
  );
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
        throw new Error("Candidate knowledge provider retrieval limit must be from 1 through 20.");
      }
      const contactRawResult = await rawQuery(
        candidateContactEvidenceQuery,
        candidateContactEvidenceQueryLimit,
      );
      const candidateContactHit = selectCandidateContactEvidence(contactRawResult);
      const chronologyRawResults: CandidateKnowledgeRetrievalResult[] = [];
      if (requiresExperienceChronology(config.requiredSections)) {
        for (const chronologyQuery of candidateKnowledgeChronologyQueries) {
          chronologyRawResults.push(
            await rawQuery(chronologyQuery, candidateKnowledgeChronologyQueryLimit),
          );
        }
      }
      const chronologyHits = selectCandidateKnowledgeChronologyHits(chronologyRawResults, limit);
      const sourceChunks =
        chronologyHits.length === 0 ? [] : await loadPinnedSourceChunks(chronologyHits);
      const composition =
        chronologyHits.length === 0
          ? { chronologyHits, requestedProjectOverflowHits: [] }
          : composeCandidateExperienceBodyEvidence(
              chronologyHits,
              sourceChunks,
              text,
              context.candidateInstructions ?? "",
            );
      const providerChronologyHits = composition.chronologyHits;
      const requestedProjectOverflowHits = composition.requestedProjectOverflowHits;
      if (requestedProjectOverflowHits.length > candidatePriorityEvidenceChunkLimit) {
        throw new Error(
          "Requested independent project evidence exceeds the bounded priority evidence slots.",
        );
      }
      const composedHeadingsByOriginalId = new Map<string, CandidateKnowledgeLexicalHit>();
      chronologyHits.forEach((heading, index) => {
        const composed = providerChronologyHits[index];
        if (composed !== undefined && composed.chunkId !== heading.chunkId) {
          composedHeadingsByOriginalId.set(heading.chunkId, composed);
        }
      });
      const replaceComposedHeading = (hit: CandidateKnowledgeLexicalHit) =>
        composedHeadingsByOriginalId.get(hit.chunkId) ?? hit;
      const priorityQuery = candidatePriorityEvidenceQuery(context.candidateInstructions);
      const priorityRawResult =
        priorityQuery === undefined
          ? undefined
          : await rawQuery(priorityQuery, candidatePriorityEvidenceQueryLimit);
      const matchedPriorityHits =
        priorityRawResult === undefined
          ? []
          : selectCandidatePriorityEvidence(priorityRawResult, limit).map(replaceComposedHeading);
      const priorityHits = [
        ...requestedProjectOverflowHits,
        ...matchedPriorityHits.filter(
          (hit) =>
            !requestedProjectOverflowHits.some(
              (overflow) =>
                overflow.chunkId === hit.chunkId ||
                (JSON.stringify(overflow.metadata.provenance) ===
                  JSON.stringify(hit.metadata.provenance) &&
                  overflow.lineStart === hit.lineStart &&
                  overflow.lineEnd === hit.lineEnd &&
                  overflow.text === hit.text),
            ),
        ),
      ].slice(0, candidatePriorityEvidenceChunkLimit);
      const productionSkillsRawResult = config.requiredSections.some(isSkillsRequiredSection)
        ? await rawQuery(
            candidateProductionSkillsEvidenceQuery,
            candidateProductionSkillsEvidenceQueryLimit,
          )
        : undefined;
      const productionSkillsRecord =
        productionSkillsRawResult === undefined
          ? undefined
          : selectCandidateProductionSkillsEvidence(productionSkillsRawResult);
      const sectionQueries = requiredSectionQueries(config.requiredSections, limit);
      const primaryLimit = Math.max(1, limit - sectionQueries.length);
      const primary = await rawQuery(text, primaryLimit);
      const supplements: RequiredSectionSupplement[] = [];
      const rawSupplementResults: CandidateKnowledgeRetrievalResult[] = [];
      const requiredSectionBodyHitsByHeadingId = new Map<string, CandidateKnowledgeLexicalHit>();
      const composedRequiredSectionBodyHits: CandidateKnowledgeLexicalHit[] = [];
      const replaceRequiredSectionBodyHit = (hit: CandidateKnowledgeLexicalHit) =>
        requiredSectionBodyHitsByHeadingId.get(hit.chunkId) ?? hit;
      for (const sectionQuery of sectionQueries) {
        const result = await rawQuery(sectionQuery.query, requiredSectionRetrievalLimit);
        rawSupplementResults.push(result);
        const headingCandidates = new Map<string, CandidateKnowledgeLexicalHit>();
        if (primary.status === "matched") {
          for (const hit of primary.hits) {
            if (
              isLeadingMarkdownHeadingOnly(hit.text) &&
              matchesRequiredSectionHeading(sectionQuery.section, hit.text)
            ) {
              headingCandidates.set(hit.chunkId, hit);
            }
          }
        }
        if (result.status === "matched") {
          for (const hit of result.hits) {
            if (
              isLeadingMarkdownHeadingOnly(hit.text) &&
              matchesRequiredSectionHeading(sectionQuery.section, hit.text)
            ) {
              headingCandidates.set(hit.chunkId, hit);
            }
          }
        }
        if (headingCandidates.size > 0) {
          const candidates = [...headingCandidates.values()];
          const sourceChunks = await loadPinnedSourceChunks(candidates);
          for (const headingHit of candidates) {
            const composed = composeCandidateRequiredSectionBodyEvidence(
              sectionQuery.section,
              headingHit,
              sourceChunks,
            );
            if (composed !== undefined) {
              requiredSectionBodyHitsByHeadingId.set(headingHit.chunkId, composed);
              composedRequiredSectionBodyHits.push(composed);
            }
          }
        }
        const hasProductionSkillsRecord =
          productionSkillsRecord !== undefined && isSkillsRequiredSection(sectionQuery.section);
        const sectionHits =
          hasProductionSkillsRecord && productionSkillsRecord !== undefined
            ? [
                productionSkillsRecord,
                ...result.hits.filter(({ chunkId }) => chunkId !== productionSkillsRecord.chunkId),
              ]
            : result.hits;
        const sectionResult: RequiredSectionRetrievalResult = {
          status: hasProductionSkillsRecord ? "matched" : result.status,
          hits: sectionHits
            .map(replaceRequiredSectionBodyHit)
            .map(replaceComposedHeading)
            .map((hit) => toScoredEvidenceChunk(hit, config.id)),
        };
        if (
          result.status === "matched" &&
          result.hits.length >= requiredSectionRetrievalLimit &&
          !hasRequiredSectionEvidence(sectionQuery.section, [
            ...primary.hits
              .map(replaceRequiredSectionBodyHit)
              .map(replaceComposedHeading)
              .map((hit) => toScoredEvidenceChunk(hit, config.id)),
            ...sectionResult.hits,
          ])
        ) {
          throw new Error(
            "Required-section evidence coverage could not be established within the retrieval limit.",
          );
        }
        supplements.push({ section: sectionQuery.section, result: sectionResult });
      }

      const primaryHits = primary.hits
        .map(replaceRequiredSectionBodyHit)
        .map(replaceComposedHeading)
        .map((hit) => toScoredEvidenceChunk(hit, config.id));
      const contactChunks =
        candidateContactHit === undefined
          ? []
          : [toScoredEvidenceChunk(candidateContactHit, config.id)];
      const chronologyChunks = providerChronologyHits.map((hit) =>
        toScoredEvidenceChunk(hit, config.id),
      );
      const mergeWithPriority = (priorityPrefix: readonly CandidateKnowledgeLexicalHit[]) => {
        const reservedChunks = [
          ...contactChunks,
          ...chronologyChunks,
          ...priorityPrefix.map((hit) => toScoredEvidenceChunk(hit, config.id)),
        ];
        const activeSupplements =
          priorityPrefix.length === 0
            ? supplements
            : supplements.filter(
                ({ section }) =>
                  !(
                    requiresExperienceChronology([section]) &&
                    hasRequiredSectionEvidence(section, chronologyChunks)
                  ),
              );
        return mergeRequiredSectionEvidence(
          {
            status: primary.status,
            hits: [...reservedChunks, ...primaryHits],
          },
          activeSupplements,
          limit,
        );
      };
      let hits = mergeWithPriority([]);
      let selectedIds = new Set(hits.map((hit) => hit.id));
      let selectedPriorityHits: readonly CandidateKnowledgeLexicalHit[] = [];
      for (let count = priorityHits.length; count >= 1; count -= 1) {
        const prefix = priorityHits.slice(0, count);
        const candidateHits = mergeWithPriority(prefix);
        const candidateIds = new Set(candidateHits.map((hit) => hit.id));
        if (
          providerChronologyHits.every((hit) => candidateIds.has(hit.chunkId)) &&
          prefix.every((hit) => candidateIds.has(hit.chunkId)) &&
          (candidateContactHit === undefined || candidateIds.has(candidateContactHit.chunkId))
        ) {
          hits = candidateHits;
          selectedIds = candidateIds;
          selectedPriorityHits = prefix;
          break;
        }
      }
      if (providerChronologyHits.some((hit) => !selectedIds.has(hit.chunkId))) {
        throw new Error("Chronology evidence could not fit within the provider retrieval limit.");
      }
      if (candidateContactHit !== undefined && !selectedIds.has(candidateContactHit.chunkId)) {
        throw new Error(
          "Candidate contact evidence could not fit within the provider retrieval limit.",
        );
      }
      if (priorityHits.length > 0 && selectedPriorityHits.length === 0) {
        throw new Error(
          "Candidate-priority evidence could not fit within the provider retrieval limit.",
        );
      }
      if (
        requestedProjectOverflowHits.some(
          ({ chunkId }) => !selectedPriorityHits.some((hit) => hit.chunkId === chunkId),
        )
      ) {
        throw new Error(
          "Requested independent project evidence could not fit within the provider retrieval limit.",
        );
      }
      assertCandidateKnowledgeProviderBounds(hits, limit);
      const rawHitsById = new Map<string, CandidateKnowledgeLexicalHit>(
        [
          contactRawResult,
          ...chronologyRawResults,
          { hits: providerChronologyHits },
          { hits: requestedProjectOverflowHits },
          { hits: composedRequiredSectionBodyHits },
          ...(priorityRawResult === undefined ? [] : [priorityRawResult]),
          ...(productionSkillsRawResult === undefined ? [] : [productionSkillsRawResult]),
          primary,
          ...rawSupplementResults,
        ]
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
          [
            contactRawResult.status,
            ...chronologyRawResults.map(({ status }) => status),
            ...(priorityRawResult === undefined ? [] : [priorityRawResult.status]),
            ...(productionSkillsRawResult === undefined ? [] : [productionSkillsRawResult.status]),
            primary.status,
            ...supplements.map(({ result: sectionResult }) => sectionResult.status),
          ],
          hits.length,
        ),
        indexedChunkCount: primary.indexedChunkCount,
        selectedChunkCount: hits.length,
        selectedSourceCount: new Set(
          selectedRawHits.map((hit) => JSON.stringify(hit.metadata.provenance)),
        ).size,
        hits: Object.freeze(selectedRawHits),
        diagnostics: mergeDiagnostics(
          [
            contactRawResult,
            ...chronologyRawResults,
            ...(priorityRawResult === undefined ? [] : [priorityRawResult]),
            ...(productionSkillsRawResult === undefined ? [] : [productionSkillsRawResult]),
            primary,
            ...rawSupplementResults,
          ],
          selectedRawHits,
        ),
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
