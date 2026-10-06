import { homedir } from "node:os";

import type {
  CandidateKnowledgeLexicalHit,
  CandidateKnowledgeRetrievalPurpose,
  CandidateKnowledgeRetrievalStatus,
  CandidateKnowledgeSelectionSnapshot,
} from "@draft-loop/domain";
import { createCandidateKnowledgeLexicalHit } from "@draft-loop/domain";
import type { SemanticRelevanceFloor, TextEmbedder } from "@draft-loop/embeddings";
import type {
  SemanticRetrievalTraceChunk,
  SemanticRetrievalTraceStoragePort,
} from "@draft-loop/storage";
import {
  type CandidateKnowledgeStoreHandle,
  openCandidateKnowledgeStore,
} from "@draft-loop/storage/knowledge-store";

import {
  createEmbeddingModelService,
  defaultEmbeddingModelRoot,
  type EmbeddingModelService,
  type EmbeddingModelTier,
} from "./embedding-model-install.js";
import type {
  CandidateKnowledgeRetrievalDiagnostic,
  CandidateKnowledgeRetrievalResult,
} from "./knowledge-base.js";
import {
  embeddingStorageIdentity,
  openLocalTextEmbedder,
  querySemanticCandidateKnowledge,
  type SemanticCandidateKnowledgeHit,
  type SemanticRetrievalMode,
  type SemanticUnavailableReason,
  synchronizeCandidateKnowledgeVectors,
} from "./semantic-candidate-knowledge-retrieval.js";
import type { RetrievalMode } from "./workspace-retrieval-mode.js";

/**
 * Semantic and hybrid retrieval for the primary job-requirement query of a run.
 *
 * The runtime keeps every other query (contact, chronology, priority, skills, required sections)
 * lexical. When semantic retrieval is unavailable the run falls back to the lexical result
 * unchanged and records why in a decision (preflight line and audit event) and in a semantic
 * companion trace beside each v1 trace. Sensitivity exclusion stays with the caller: it must run
 * on the result returned here before any trace is written.
 */

/** What the run did with the requested retrieval mode; content-free. */
export interface RetrievalModeDecision {
  readonly requestedMode: RetrievalMode;
  readonly effectiveMode: RetrievalMode;
  readonly tier: EmbeddingModelTier;
  readonly reason?: SemanticUnavailableReason;
  /** Chunks with a current vector in the selected knowledge bases; zero when unavailable. */
  readonly embeddedChunkCount: number;
  readonly modelId?: string;
  readonly revision?: string;
}

/** Workspace setting plus the local model location, as the run start resolves it. */
export interface RunSemanticRetrievalOptions {
  readonly mode: SemanticRetrievalMode;
  readonly tier: EmbeddingModelTier;
  readonly modelRoot: string;
  /** Injectable for tests. */
  readonly modelService?: Pick<EmbeddingModelService, "status">;
  readonly createEmbedder?: (options: {
    readonly modelDirectory: string;
    readonly tier: EmbeddingModelTier;
  }) => Promise<TextEmbedder>;
  /**
   * Injected `createEmbedder` or `modelService` bypass the process-wide embedder cache so tests
   * stay isolated; set this to exercise the cache with an injected factory.
   */
  readonly shareEmbedder?: boolean;
  readonly open?: (storeRoot: string) => Promise<CandidateKnowledgeStoreHandle>;
  /** Overrides the model's calibrated relevance floor; injectable for tests. */
  readonly relevanceFloor?: SemanticRelevanceFloor;
}

type OpenedEmbedder = Awaited<ReturnType<typeof openLocalTextEmbedder>>;

/**
 * Embedders shared by every run in the process, keyed by resolved model directory and tier. A
 * loaded model is large (about 900 MB for the 311m tier), and the desktop starts many runs in one
 * process, so a run never owns or disposes its embedder. Only successful opens are kept: a failed
 * open is forgotten so a later install is picked up by the next run.
 */
const sharedEmbedders = new Map<string, Promise<OpenedEmbedder>>();

export function resetRunEmbedderCacheForTests(): void {
  sharedEmbedders.clear();
}

async function openRunEmbedder(options: RunSemanticRetrievalOptions): Promise<OpenedEmbedder> {
  const open = (service?: Pick<EmbeddingModelService, "status">) =>
    openLocalTextEmbedder({
      modelRoot: options.modelRoot,
      tier: options.tier,
      ...(service === undefined ? {} : { service }),
      ...(options.createEmbedder === undefined ? {} : { createEmbedder: options.createEmbedder }),
    });
  const injected = options.createEmbedder !== undefined || options.modelService !== undefined;
  if (injected && options.shareEmbedder !== true) {
    return open(options.modelService);
  }
  const service =
    options.modelService ?? createEmbeddingModelService({ modelRoot: options.modelRoot });
  let status: Awaited<ReturnType<typeof service.status>>;
  try {
    status = await service.status(options.tier);
  } catch {
    return open(service);
  }
  // Anything but a ready model is reported by the uncached open, with its reason.
  if (status.state !== "ready") return open({ status: async () => status });
  const key = `${status.modelDirectory}|${options.tier}`;
  const cached = sharedEmbedders.get(key);
  if (cached !== undefined) return cached;
  const pending = open({ status: async () => status }).then(
    (opened) => {
      if (!opened.ok && sharedEmbedders.get(key) === pending) sharedEmbedders.delete(key);
      return opened;
    },
    (error: unknown) => {
      if (sharedEmbedders.get(key) === pending) sharedEmbedders.delete(key);
      throw error;
    },
  );
  sharedEmbedders.set(key, pending);
  return pending;
}

/** The model root for the current process: the environment override or the platform default. */
export function runEmbeddingModelRoot(): string {
  return defaultEmbeddingModelRoot({
    env: process.env,
    platform: process.platform,
    homedir: homedir(),
  });
}

export function retrievalModePreflightLine(decision: RetrievalModeDecision): string {
  if (decision.effectiveMode === decision.requestedMode) {
    return `Retrieval mode: ${decision.effectiveMode} (${decision.tier}), ${decision.embeddedChunkCount} chunks embedded`;
  }
  const reason = decision.reason ?? "runtime-failed";
  const remedy =
    reason === "model-absent" || reason === "model-corrupt"
      ? ` Run "draft-loop embeddings install --tier ${decision.tier}".`
      : "";
  return `Retrieval mode: ${decision.requestedMode} requested; using lexical (${reason}).${remedy}`;
}

interface Target {
  readonly storeRoot: string;
  readonly entry: CandidateKnowledgeSelectionSnapshot["entries"][number];
  readonly diagnostic: CandidateKnowledgeRetrievalDiagnostic;
}

type Prepared =
  | {
      readonly ok: true;
      readonly embedder: TextEmbedder;
      readonly targets: readonly Target[];
      readonly decision: RetrievalModeDecision;
    }
  | { readonly ok: false; readonly decision: RetrievalModeDecision };

export interface RunSemanticRetrievalRequest {
  readonly options: RunSemanticRetrievalOptions;
  readonly workspaceId: string;
  readonly entries: readonly { readonly storeRoot: string; readonly knowledgeBaseId: string }[];
  /**
   * The current exact-version snapshot, taken the way the lexical sync takes it. Retrieval indexes
   * the versions current at query time, so a vector projection must be built from the same ones.
   */
  readonly currentSnapshot: () => Promise<CandidateKnowledgeSelectionSnapshot>;
  readonly storage: {
    readonly candidateKnowledgeSemanticRetrievalTrace: Pick<
      SemanticRetrievalTraceStoragePort,
      "appendSemanticRetrievalTrace"
    >;
  };
  /**
   * Run one lexical query for the selection and return its diagnostics. It brings every lexical
   * index up to date, which must happen before vectors are synchronized because a lexical rebuild
   * removes the vector rows of the knowledge base.
   */
  readonly ensureLexicalIndex: () => Promise<readonly CandidateKnowledgeRetrievalDiagnostic[]>;
  readonly purpose: CandidateKnowledgeRetrievalPurpose;
  readonly now?: () => string;
}

/** One v1 trace that a companion annotates. */
export interface RunSemanticTraceReference {
  readonly traceId: string;
  readonly storeId: string;
  readonly knowledgeBaseId: string;
}

export interface RunSemanticPrimaryOutcome {
  /** The result to filter, trace and use; the lexical one unchanged on fallback. */
  readonly result: CandidateKnowledgeRetrievalResult;
  /**
   * Write the companion traces. Call after the v1 traces exist, passing the filtered result so
   * withheld chunks never reach a companion.
   */
  readonly recordTraces: (
    filtered: CandidateKnowledgeRetrievalResult,
    references: readonly RunSemanticTraceReference[],
  ) => Promise<void>;
}

export interface RunSemanticRetrieval {
  readonly mode: SemanticRetrievalMode;
  readonly prepare: (known?: readonly CandidateKnowledgeRetrievalDiagnostic[]) => Promise<void>;
  readonly decision: () => Promise<RetrievalModeDecision>;
  readonly primaryQuery: (request: {
    readonly query: string;
    readonly limit: number;
    readonly lexical: CandidateKnowledgeRetrievalResult;
  }) => Promise<RunSemanticPrimaryOutcome>;
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** True when the entry pins exactly the source versions of the indexed lexical scope. */
function sameSourceVersions(
  entry: CandidateKnowledgeSelectionSnapshot["entries"][number],
  scope: CandidateKnowledgeRetrievalDiagnostic["scope"],
): boolean {
  const key = (reference: { readonly sourceId: string; readonly versionId: string }) =>
    JSON.stringify([reference.sourceId, reference.versionId]);
  const left = entry.sources.map(key).sort();
  const right = scope.sources.map(key).sort();
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function targetKey(value: { readonly storeId: string; readonly knowledgeBaseId: string }): string {
  return JSON.stringify([value.storeId, value.knowledgeBaseId]);
}

function aggregateStatus(
  diagnostics: readonly CandidateKnowledgeRetrievalDiagnostic[],
  hitCount: number,
): CandidateKnowledgeRetrievalStatus {
  if (hitCount > 0) {
    return diagnostics.some(({ status }) => status === "matched") ? "matched" : "bounded-fallback";
  }
  if (diagnostics.some(({ status }) => status === "not-indexed")) return "not-indexed";
  if (diagnostics.some(({ status }) => status === "stale")) return "stale";
  if (diagnostics.some(({ status }) => status === "bounded-fallback")) return "bounded-fallback";
  if (diagnostics.length > 0 && diagnostics.every(({ status }) => status === "no-query")) {
    return "no-query";
  }
  return "matched";
}

async function useStore<T>(
  open: (storeRoot: string) => Promise<CandidateKnowledgeStoreHandle>,
  storeRoot: string,
  expectedStoreId: string | undefined,
  operation: (handle: CandidateKnowledgeStoreHandle) => Promise<T>,
): Promise<T> {
  const handle = await open(storeRoot);
  try {
    if (expectedStoreId !== undefined && handle.descriptor.id !== expectedStoreId) {
      throw new Error("The candidate knowledge store changed.");
    }
    return await operation(handle);
  } finally {
    try {
      await handle.close();
    } catch {
      // The operation outcome is what matters; the handle was still given a close attempt.
    }
  }
}

export function createRunSemanticRetrieval(
  request: RunSemanticRetrievalRequest,
): RunSemanticRetrieval {
  const { options, workspaceId } = request;
  const open = options.open ?? openCandidateKnowledgeStore;
  const now = request.now ?? (() => new Date().toISOString());
  const unavailable = (reason: SemanticUnavailableReason): Prepared => ({
    ok: false,
    decision: {
      requestedMode: options.mode,
      effectiveMode: "lexical",
      tier: options.tier,
      reason,
      embeddedChunkCount: 0,
    },
  });

  const prepareOnce = async (
    known: readonly CandidateKnowledgeRetrievalDiagnostic[] | undefined,
  ): Promise<Prepared> => {
    const opened = await openRunEmbedder(options);
    if (!opened.ok) return unavailable(opened.reason);
    const { embedder } = opened;
    // Lexical indexes first: a lexical rebuild cascades away the vectors of its knowledge base.
    const diagnostics = known ?? (await request.ensureLexicalIndex());
    try {
      const snapshot = await request.currentSnapshot();
      const targets: Target[] = [];
      let embeddedChunkCount = 0;
      for (const binding of request.entries) {
        const target = await useStore(open, binding.storeRoot, undefined, async (handle) => {
          const storeId = handle.descriptor.id;
          const entry = snapshot.entries.find(
            (candidate) =>
              candidate.storeId === storeId &&
              candidate.knowledgeBaseId === binding.knowledgeBaseId,
          );
          const diagnostic = diagnostics.find(
            (candidate) =>
              candidate.storeId === storeId &&
              candidate.knowledgeBaseId === binding.knowledgeBaseId,
          );
          if (
            entry === undefined ||
            diagnostic === undefined ||
            !sameSourceVersions(entry, diagnostic.scope)
          ) {
            return undefined;
          }
          const synchronized = await synchronizeCandidateKnowledgeVectors({
            handle,
            prepared: { entry, scope: diagnostic.scope },
            embedder,
            createdAt: now(),
          });
          return { synchronized, target: { storeRoot: binding.storeRoot, entry, diagnostic } };
        });
        if (target === undefined) {
          return unavailable("index-stale");
        }
        if (!target.synchronized.ok) {
          return unavailable(target.synchronized.reason);
        }
        embeddedChunkCount += target.target.diagnostic.indexedChunkCount;
        targets.push(target.target);
      }
      const { modelId, revision } = embedder.identity;
      return {
        ok: true,
        embedder,
        targets,
        decision: {
          requestedMode: options.mode,
          effectiveMode: options.mode,
          tier: options.tier,
          embeddedChunkCount,
          modelId,
          revision,
        },
      };
    } catch {
      return unavailable("runtime-failed");
    }
  };

  let prepared: Promise<Prepared> | undefined;
  const ensurePrepared = (
    known?: readonly CandidateKnowledgeRetrievalDiagnostic[],
  ): Promise<Prepared> => {
    prepared ??= prepareOnce(known);
    return prepared;
  };

  const appendCompanions = async (
    references: readonly RunSemanticTraceReference[],
    build: (reference: RunSemanticTraceReference) => {
      readonly outcome: "semantic-used" | "semantic-unavailable";
      readonly reason?: SemanticUnavailableReason;
      readonly embeddingIdentity?: ReturnType<typeof embeddingStorageIdentity>;
      readonly selectedChunks: readonly SemanticRetrievalTraceChunk[];
    },
  ): Promise<void> => {
    const createdAt = now();
    for (const reference of references) {
      await request.storage.candidateKnowledgeSemanticRetrievalTrace.appendSemanticRetrievalTrace({
        workspaceId,
        traceId: reference.traceId,
        retrievalMode: options.mode,
        createdAt,
        ...build(reference),
      });
    }
  };

  const recordUnavailable =
    (reason: SemanticUnavailableReason) =>
    (
      _filtered: CandidateKnowledgeRetrievalResult,
      references: readonly RunSemanticTraceReference[],
    ) =>
      appendCompanions(references, () => ({
        outcome: "semantic-unavailable",
        reason,
        selectedChunks: [],
      }));

  return {
    mode: options.mode,
    prepare: async (known) => {
      await ensurePrepared(known);
    },
    decision: async () => (await ensurePrepared()).decision,
    primaryQuery: async ({ query, limit, lexical }) => {
      const state = await ensurePrepared(lexical.diagnostics);
      if (!state.ok) {
        return {
          result: lexical,
          recordTraces: recordUnavailable(state.decision.reason ?? "runtime-failed"),
        };
      }
      // A query without searchable terms has nothing to embed; keep the lexical outcome as is.
      if (
        lexical.diagnostics.length > 0 &&
        lexical.diagnostics.every(({ status }) => status === "no-query")
      ) {
        return { result: lexical, recordTraces: async () => undefined };
      }

      const hitsByTarget = new Map<string, readonly SemanticCandidateKnowledgeHit[]>();
      for (const target of state.targets) {
        // The lexical diagnostics of this very query carry the exact indexed scope.
        const diagnostic =
          lexical.diagnostics.find(
            (candidate) => targetKey(candidate) === targetKey(target.diagnostic),
          ) ?? target.diagnostic;
        let queried: Awaited<ReturnType<typeof querySemanticCandidateKnowledge>>;
        try {
          queried = await useStore(open, target.storeRoot, target.entry.storeId, (handle) =>
            querySemanticCandidateKnowledge({
              handle,
              prepared: { entry: target.entry, scope: diagnostic.scope },
              embedder: state.embedder,
              mode: options.mode,
              purpose: request.purpose,
              query,
              limit,
              ...(options.relevanceFloor === undefined
                ? {}
                : { relevanceFloor: options.relevanceFloor }),
            }),
          );
        } catch {
          queried = { ok: false, reason: "runtime-failed" };
        }
        if (!queried.ok) {
          return { result: lexical, recordTraces: recordUnavailable(queried.reason) };
        }
        hitsByTarget.set(targetKey(target.entry), queried.hits);
      }

      const rawBm25 = new Map<string, number>();
      for (const diagnostic of lexical.diagnostics) {
        for (const { chunkId, bm25Rank } of diagnostic.selectedChunks) {
          rawBm25.set(JSON.stringify([targetKey(diagnostic), chunkId]), bm25Rank);
        }
      }
      const vectorByChunk = new Map<string, { vectorScore: number; vectorRank: number }>();
      const candidates: {
        readonly hit: CandidateKnowledgeLexicalHit;
        readonly fusedRank: number;
        readonly storeId: string;
        readonly knowledgeBaseId: string;
      }[] = [];
      for (const target of state.targets) {
        const key = targetKey(target.entry);
        for (const semantic of hitsByTarget.get(key) ?? []) {
          const hit = createCandidateKnowledgeLexicalHit({
            ...semantic.chunk,
            bm25Rank: rawBm25.get(JSON.stringify([key, semantic.chunk.chunkId])) ?? 0,
          });
          if (semantic.vectorScore !== null && semantic.vectorRank !== null) {
            vectorByChunk.set(JSON.stringify([key, hit.chunkId]), {
              // Float32 rounding can overshoot a unit cosine by an ulp; the trace contract is [-1, 1].
              vectorScore: Math.max(-1, Math.min(1, semantic.vectorScore)),
              vectorRank: semantic.vectorRank,
            });
          }
          candidates.push({
            hit,
            fusedRank: -(1 / (60 + semantic.fusedRank)),
            storeId: target.entry.storeId,
            knowledgeBaseId: target.entry.knowledgeBaseId,
          });
        }
      }
      candidates.sort(
        (left, right) =>
          left.fusedRank - right.fusedRank ||
          compare(left.storeId, right.storeId) ||
          compare(left.knowledgeBaseId, right.knowledgeBaseId) ||
          compare(left.hit.chunkId, right.hit.chunkId),
      );
      const embeddingIdentity = embeddingStorageIdentity(state.embedder);
      if (candidates.length === 0) {
        // The relevance floor rejected every semantic candidate. Keep the lexical result rather
        // than a silent empty primary query, and record that semantic retrieval ran.
        return {
          result: lexical,
          recordTraces: (_filtered, references) =>
            appendCompanions(references, () => ({
              outcome: "semantic-used",
              embeddingIdentity,
              selectedChunks: [],
            })),
        };
      }
      const hits = candidates.slice(0, limit).map(({ hit }) => hit);

      const diagnostics = lexical.diagnostics.map((diagnostic) => {
        const scopeHits = hits.filter(
          (hit) => targetKey(hit.metadata.provenance) === targetKey(diagnostic),
        );
        const selectedChunks = scopeHits
          .map(({ chunkId, bm25Rank }) => ({ chunkId, bm25Rank }))
          .sort(
            (left, right) => left.bm25Rank - right.bm25Rank || compare(left.chunkId, right.chunkId),
          );
        return Object.freeze({
          ...diagnostic,
          status: scopeHits.length > 0 ? ("matched" as const) : diagnostic.status,
          selectedChunkCount: selectedChunks.length,
          selectedSourceCount: new Set(
            scopeHits.map((hit) => JSON.stringify(hit.metadata.provenance)),
          ).size,
          selectedChunks: Object.freeze(selectedChunks),
        });
      });
      const result: CandidateKnowledgeRetrievalResult = Object.freeze({
        status: aggregateStatus(diagnostics, hits.length),
        indexedChunkCount: lexical.indexedChunkCount,
        selectedChunkCount: hits.length,
        selectedSourceCount: new Set(hits.map((hit) => JSON.stringify(hit.metadata.provenance)))
          .size,
        hits: Object.freeze(hits),
        diagnostics: Object.freeze(diagnostics),
      });
      return {
        result,
        recordTraces: (filtered, references) =>
          appendCompanions(references, (reference) => {
            const diagnostic = filtered.diagnostics.find(
              (candidate) => targetKey(candidate) === targetKey(reference),
            );
            const selectedChunks: SemanticRetrievalTraceChunk[] = [];
            for (const { chunkId } of diagnostic?.selectedChunks ?? []) {
              const vector = vectorByChunk.get(JSON.stringify([targetKey(reference), chunkId]));
              if (vector !== undefined) selectedChunks.push({ chunkId, ...vector });
            }
            selectedChunks.sort((left, right) => left.vectorRank - right.vectorRank);
            return { outcome: "semantic-used", embeddingIdentity, selectedChunks };
          }),
      };
    },
  };
}
