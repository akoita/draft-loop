import { createHash, randomUUID } from "node:crypto";

import type {
  CandidateKnowledgeLexicalChunkInput,
  CandidateKnowledgeLexicalHit,
  CandidateKnowledgeRetrievalSourceVersionReference,
  CandidateKnowledgeRetrievalStatus,
  ContextSnapshot,
  RetrievalPort,
  ScoredEvidenceChunk,
} from "@draft-loop/domain";
import { createCandidateKnowledgeLexicalHit } from "@draft-loop/domain";
import type { SqliteStorage } from "@draft-loop/storage";
import {
  candidateContactEvidenceQuery,
  candidateContactEvidenceQueryLimit,
  selectCandidateContactEvidence,
} from "./candidate-contact-evidence.js";
import {
  composeCandidateExperienceBodyEvidence,
  createPinnedCandidateKnowledgeSourceReferenceChunkLoader,
} from "./candidate-experience-body-evidence.js";
import {
  assertCandidateKnowledgeProviderBounds,
  candidateKnowledgeChronologyLocalSourceByteLimit,
  candidateKnowledgeChronologyQueries,
  candidateKnowledgeChronologyQueryLimit,
  requiresExperienceChronology,
  selectCandidateKnowledgeChronologyHits,
  selectCandidateKnowledgeChronologySourceChunks,
} from "./candidate-knowledge-chronology.js";
import { isLeadingMarkdownHeadingOnly } from "./candidate-knowledge-heading.js";
import { candidateKnowledgeSearchText } from "./candidate-knowledge-query.js";
import type { CandidateKnowledgeQueryBatch } from "./candidate-knowledge-query-batch.js";
import {
  type CandidateKnowledgeSensitivityExclusions,
  createCandidateKnowledgeSensitivityExclusions,
} from "./candidate-knowledge-sensitivity-exclusion.js";
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
import {
  decideFullSourceEvidence,
  type EvidenceModeDecision,
  type EvidenceModeRetrieval,
  fullSourceBudgetCharacters,
  fullSourceInspectionResult,
  retrievalEvidenceModeDecision,
} from "./full-source-evidence.js";
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
import {
  createRunSemanticRetrieval,
  type RetrievalModeDecision,
  type RunSemanticRetrievalOptions,
  type RunSemanticTraceReference,
} from "./run-semantic-retrieval.js";
import type { EvidenceMode } from "./workspace-evidence-mode.js";

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
  storage: Pick<SqliteStorage, "appendCandidateKnowledgeRetrievalTrace"> &
    Partial<Pick<SqliteStorage, "candidateKnowledgeSemanticRetrievalTrace">>,
  config: CandidateKnowledgeRuntimeConfig,
  context: ContextSnapshot,
  /** Withheld-section filter; defaults to the one built from the knowledge base's current rules. */
  exclusions?: CandidateKnowledgeSensitivityExclusions,
  /** `full-source` sends every eligible chunk when it fits the budget; see full-source-evidence. */
  evidenceMode: EvidenceMode = "retrieval",
  /**
   * Semantic or hybrid retrieval of the primary job-requirement query; absent means lexical only,
   * exactly as before. Every other query stays lexical.
   */
  semanticOptions?: RunSemanticRetrievalOptions,
):
  | (EvidenceModeRetrieval & {
      readonly port: RetrievalPort;
      readonly inspect: (query: string) => Promise<CandidateKnowledgeRetrievalResult>;
      /**
       * Ids of the contact, chronology and priority chunks reserved by a completed `port` query
       * with this text and limit; empty before that query or in full-source mode.
       */
      readonly reservedEvidenceIds: (query: string, limit?: number) => ReadonlySet<string>;
      /** Eligible chunks of exact pinned source versions, withheld sections already dropped. */
      readonly loadPinnedSourceChunks: (
        references: readonly CandidateKnowledgeRetrievalSourceVersionReference[],
      ) => Promise<readonly CandidateKnowledgeLexicalChunkInput[]>;
    })
  | undefined {
  const binding = config.candidateKnowledgeSelection;
  const selection = context.candidateKnowledgeSelection;
  if (binding === undefined || selection === undefined) return undefined;

  const service = createCandidateKnowledgeStoreService();
  const withheld =
    exclusions ?? createCandidateKnowledgeSensitivityExclusions(binding.entries, selection);
  const loadAllPinnedSourceReferences = createPinnedCandidateKnowledgeSourceReferenceChunkLoader(
    binding.entries,
    selection,
  );
  // Chunks in withheld sections are dropped here and below, before any selection or tracing.
  const loadPinnedSourceReferences: typeof loadAllPinnedSourceReferences = async (...args) =>
    withheld.filterChunks(await loadAllPinnedSourceReferences(...args));
  const loadPinnedSourceChunks = (hits: readonly CandidateKnowledgeLexicalHit[]) =>
    loadPinnedSourceReferences(hits.map((hit) => hit.metadata.provenance));
  const lexicalSelections = binding.entries.map(({ storeRoot, knowledgeBaseId }) => ({
    storeRoot,
    knowledgeBaseId,
  }));
  const lexicalQuery = (searchText: string, limit: number) =>
    service.queryCandidateKnowledge({
      selections: lexicalSelections,
      ...(binding.combinationApproved === undefined
        ? {}
        : { combinationApproved: binding.combinationApproved }),
      purpose: "achievement-recall",
      query: searchText,
      limit,
    });
  const semanticTraceStorage = storage.candidateKnowledgeSemanticRetrievalTrace;
  if (semanticOptions !== undefined && semanticTraceStorage === undefined) {
    throw new Error("Semantic retrieval requires storage with semantic retrieval traces.");
  }
  const semantic =
    semanticOptions === undefined || semanticTraceStorage === undefined
      ? undefined
      : createRunSemanticRetrieval({
          options: semanticOptions,
          workspaceId: config.id,
          entries: binding.entries,
          currentSnapshot: () =>
            service.createKnowledgeSelectionSnapshot({
              selections: lexicalSelections,
              ...(binding.combinationApproved === undefined
                ? {}
                : { combinationApproved: binding.combinationApproved }),
            }),
          storage: { candidateKnowledgeSemanticRetrievalTrace: semanticTraceStorage },
          // A one-chunk lexical query only brings the lexical indexes up to date.
          ensureLexicalIndex: async () => (await lexicalQuery("", 1)).diagnostics,
          purpose: "achievement-recall",
        });
  const rawCache = new Map<string, Promise<CandidateKnowledgeRetrievalResult>>();
  const combinedCache = new Map<string, Promise<CandidateKnowledgeRetrievalResult>>();
  const reservedIdsByQuery = new Map<string, ReadonlySet<string>>();
  type RawQuery = (
    text: string,
    limit: number,
    primary?: boolean,
  ) => Promise<CandidateKnowledgeRetrievalResult>;
  /**
   * One retrieval operation shares one synchronized selection: its lexical queries prepare it on the
   * first miss and `verify` once at the end, so a selection change during the operation still fails
   * it. A batch never spans operations. Results a failed operation cached are evicted so a later
   * operation cannot reuse an unverified one.
   */
  const runOperation = async <T>(compute: (rawQuery: RawQuery) => Promise<T>): Promise<T> => {
    const batch = service.createCandidateKnowledgeQueryBatch({
      selections: lexicalSelections,
      ...(binding.combinationApproved === undefined
        ? {}
        : { combinationApproved: binding.combinationApproved }),
    });
    const cachedKeys: string[] = [];
    try {
      const result = await compute((text, limit, primary = false) =>
        rawQuery(batch, cachedKeys, text, limit, primary),
      );
      await batch.verify();
      return result;
    } catch (error) {
      for (const key of cachedKeys) rawCache.delete(key);
      throw error;
    }
  };
  const rawQuery = (
    batch: CandidateKnowledgeQueryBatch,
    cachedKeys: string[],
    text: string,
    limit: number,
    primary: boolean,
  ): Promise<CandidateKnowledgeRetrievalResult> => {
    const searchText = candidateKnowledgeSearchText(text);
    const semanticPrimary = primary && semantic !== undefined;
    const key = JSON.stringify(
      semanticPrimary ? [searchText, limit, semantic.mode] : [searchText, limit],
    );
    const existing = rawCache.get(key);
    if (existing !== undefined) return existing;
    const pending = (async () => {
      const startedAt = Date.now();
      const operationId = `ckb-retrieval-${randomUUID()}`;
      const lexical = await batch.query({
        purpose: "achievement-recall",
        query: searchText,
        limit,
      });
      const semanticOutcome = semanticPrimary
        ? await semantic.primaryQuery({ query: searchText, limit, lexical })
        : undefined;
      // Withheld chunks are dropped here, before any trace, whichever side produced them.
      const result = await withheld.filterResult(semanticOutcome?.result ?? lexical);
      const traceReferences: RunSemanticTraceReference[] = [];
      const createdAt = timestamp();
      const queryChecksum = createHash("sha256").update(searchText, "utf8").digest("hex");
      const latencyMs = Math.max(0, Date.now() - startedAt);
      for (const diagnostic of result.diagnostics) {
        const traceId = `trace-${randomUUID()}`;
        traceReferences.push({
          traceId,
          storeId: diagnostic.storeId,
          knowledgeBaseId: diagnostic.knowledgeBaseId,
        });
        await storage.appendCandidateKnowledgeRetrievalTrace({
          id: traceId,
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
      await semanticOutcome?.recordTraces(result, traceReferences);
      return result;
    })();
    rawCache.set(key, pending);
    cachedKeys.push(key);
    return pending;
  };

  const query = (text: string, limit = 20): Promise<CandidateKnowledgeRetrievalResult> => {
    const key = JSON.stringify([text, limit]);
    const existing = combinedCache.get(key);
    if (existing !== undefined) return existing;
    const compute = async (rawQuery: RawQuery) => {
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
      const chronologySaturated = chronologyRawResults.some(
        (result) =>
          result.status === "matched" &&
          result.hits.length >= candidateKnowledgeChronologyQueryLimit,
      );
      let chronologyHits: readonly CandidateKnowledgeLexicalHit[];
      let sourceChunks: readonly CandidateKnowledgeLexicalChunkInput[];
      if (chronologySaturated) {
        const sourceReferences = selection.entries.flatMap((entry) =>
          entry.sources.map((source) => ({
            storeId: entry.storeId,
            knowledgeBaseId: entry.knowledgeBaseId,
            sourceId: source.sourceId,
            versionId: source.versionId,
          })),
        );
        sourceChunks = await loadPinnedSourceReferences(
          sourceReferences,
          candidateKnowledgeChronologyLocalSourceByteLimit,
        );
        chronologyHits = selectCandidateKnowledgeChronologySourceChunks(sourceChunks, limit).map(
          (chunk) =>
            createCandidateKnowledgeLexicalHit({
              ...chunk,
              bm25Rank: 0,
            }),
        );
      } else {
        chronologyHits = selectCandidateKnowledgeChronologyHits(chronologyRawResults, limit);
        sourceChunks =
          chronologyHits.length === 0 ? [] : await loadPinnedSourceChunks(chronologyHits);
      }
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
      const primary = await rawQuery(text, primaryLimit, true);
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
      reservedIdsByQuery.set(
        key,
        new Set([
          ...contactChunks.map(({ id }) => id),
          ...chronologyChunks.map(({ id }) => id),
          ...selectedPriorityHits.map(({ chunkId }) => chunkId),
        ]),
      );
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
    };
    const pending = runOperation(compute);
    combinedCache.set(key, pending);
    return pending;
  };

  type FullSourceEvidence = {
    readonly decision: EvidenceModeDecision;
    readonly hits: readonly CandidateKnowledgeLexicalHit[];
    readonly evidence: readonly ScoredEvidenceChunk[];
  };
  let fullSource: Promise<FullSourceEvidence> | undefined;
  /** Every eligible chunk of every pinned source, in selection, source and chunk order. */
  const resolveFullSource = (): Promise<FullSourceEvidence> => {
    fullSource ??= (async () => {
      if (evidenceMode !== "full-source") {
        return { decision: retrievalEvidenceModeDecision, hits: [], evidence: [] };
      }
      const chunks = await loadPinnedSourceReferences(
        selection.entries.flatMap((entry) =>
          entry.sources.map((source) => ({
            storeId: entry.storeId,
            knowledgeBaseId: entry.knowledgeBaseId,
            sourceId: source.sourceId,
            versionId: source.versionId,
          })),
        ),
      );
      const hits = chunks.map((chunk) =>
        createCandidateKnowledgeLexicalHit({ ...chunk, bm25Rank: 0 }),
      );
      const evidence = hits.map((hit) => toScoredEvidenceChunk(hit, config.id));
      const decision = decideFullSourceEvidence(
        evidence,
        fullSourceBudgetCharacters(context.modelConfiguration),
      );
      return { decision, hits, evidence };
    })();
    return fullSource;
  };

  return {
    reservedEvidenceIds: (text, limit = 20) =>
      reservedIdsByQuery.get(JSON.stringify([text, limit])) ?? new Set(),
    loadPinnedSourceChunks: (references) => loadPinnedSourceReferences(references),
    evidenceModeDecision: async () => (await resolveFullSource()).decision,
    ...(semantic === undefined
      ? {}
      : {
          retrievalModeDecision: async (): Promise<RetrievalModeDecision | undefined> =>
            // A full-source run sends every chunk, so no retrieval mode applies to it.
            (await resolveFullSource()).decision.effectiveMode === "full-source"
              ? undefined
              : semantic.decision(),
        }),
    inspect: async (text) => {
      const full = await resolveFullSource();
      return full.decision.effectiveMode === "full-source"
        ? fullSourceInspectionResult(full.hits)
        : query(text);
    },
    port: {
      queryEvidence: async (text, options) => {
        const full = await resolveFullSource();
        if (full.decision.effectiveMode === "full-source") return full.evidence;
        const result = await query(text, options?.limit);
        return result.hits.map((hit) => toScoredEvidenceChunk(hit, config.id));
      },
    },
  };
}
