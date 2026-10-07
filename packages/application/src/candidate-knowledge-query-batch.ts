import {
  type CandidateKnowledgeLexicalHit,
  type CandidateKnowledgeLexicalRetrievalResult,
  type CandidateKnowledgeRetrievalPurpose,
  type CandidateKnowledgeRetrievalScopeInput,
  type CandidateKnowledgeRetrievalStatus,
  candidateKnowledgeRetrievalPurposes,
  maximumCandidateKnowledgeRetrievalChunkCount,
  maximumCandidateKnowledgeRetrievalQueryLength,
} from "@draft-loop/domain";
import type { ingestBytes } from "@draft-loop/ingestion";
import type { CandidateKnowledgeStoreHandle } from "@draft-loop/storage/knowledge-store";
import { StorageWriterLeaseError } from "@draft-loop/storage/writer-lease";
import {
  type PreparedCandidateKnowledgeLexicalSelection,
  synchronizeCandidateKnowledgeLexicalSelection,
} from "./candidate-knowledge-lexical-sync.js";
import type {
  CandidateKnowledgeRetrievalDiagnostic,
  CandidateKnowledgeRetrievalResult,
  CreateKnowledgeSelectionSnapshotCommand,
  KnowledgeSelectionSnapshot,
  QueryCandidateKnowledgeCommand,
  RebuildCandidateKnowledgeLexicalIndexesCommand,
} from "./knowledge-base.js";

export function lexicalIndexFailure(): Error {
  return new Error("The candidate knowledge lexical index could not be synchronized.");
}

function lexicalRetrievalFailure(): Error {
  return new Error("The candidate knowledge retrieval could not be completed.");
}

function lexicalSelectionChangedFailure(): Error {
  return new Error("The candidate knowledge selection changed during retrieval.");
}

/** One query of a batch; the selections and combination approval belong to the batch. */
export interface CandidateKnowledgeBatchQuery {
  readonly purpose: CandidateKnowledgeRetrievalPurpose;
  readonly query: string;
  readonly limit?: number;
}

/**
 * Queries of one retrieval operation that share one synchronized and verified CKB selection.
 *
 * The first `query` snapshots the selection and synchronizes (or reuses) each lexical index under
 * the store writer lease, exactly as a standalone query does. Later queries only read. `verify`
 * re-snapshots the selection and fails when it changed since synchronization, so one operation
 * is checked once rather than once per query. A batch is single-operation: do not span several
 * operations with one batch, so selection drift stays bounded by the operation.
 */
export interface CandidateKnowledgeQueryBatch {
  readonly query: (
    query: CandidateKnowledgeBatchQuery,
  ) => Promise<CandidateKnowledgeRetrievalResult>;
  /** No-op until a query has prepared the batch. */
  readonly verify: () => Promise<void>;
}

export interface CandidateKnowledgeQueryBatchDependencies {
  readonly createSnapshot: (
    command: CreateKnowledgeSelectionSnapshotCommand,
  ) => Promise<KnowledgeSelectionSnapshot>;
  readonly open: (storeRoot: string) => Promise<CandidateKnowledgeStoreHandle>;
  readonly ingestBytes: typeof ingestBytes;
  readonly now: () => string;
  readonly requireText: (value: string, label: string) => string;
  readonly requireStoreRoot: (value: string) => string;
  readonly useHandle: <T>(
    acquire: () => Promise<CandidateKnowledgeStoreHandle>,
    operation: (handle: CandidateKnowledgeStoreHandle) => Promise<T>,
  ) => Promise<T>;
  readonly useWriterHandle: <T>(
    operation: string,
    acquire: () => Promise<CandidateKnowledgeStoreHandle>,
    callback: (handle: CandidateKnowledgeStoreHandle) => Promise<T>,
  ) => Promise<T>;
}

export interface CandidateKnowledgeLexicalQueryRuntime {
  /** Synchronize every selected lexical index; `reuseCurrent` keeps an already current one. */
  readonly synchronize: (
    command: RebuildCandidateKnowledgeLexicalIndexesCommand,
    reuseCurrent: boolean,
  ) => Promise<readonly PreparedCandidateKnowledgeLexicalSelection[]>;
  readonly createBatch: (
    command: RebuildCandidateKnowledgeLexicalIndexesCommand,
  ) => CandidateKnowledgeQueryBatch;
  readonly query: (
    command: QueryCandidateKnowledgeCommand,
  ) => Promise<CandidateKnowledgeRetrievalResult>;
}

interface SynchronizedSelection {
  readonly prepared: readonly PreparedCandidateKnowledgeLexicalSelection[];
  readonly snapshot: KnowledgeSelectionSnapshot;
  readonly selectionCommand: CreateKnowledgeSelectionSnapshotCommand;
}

function lexicalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function lexicalReferenceKey(reference: {
  readonly storeId: string;
  readonly knowledgeBaseId: string;
  readonly sourceId: string;
  readonly versionId: string;
}): string {
  return JSON.stringify([
    reference.storeId,
    reference.knowledgeBaseId,
    reference.sourceId,
    reference.versionId,
  ]);
}

function lexicalScopeForEntry(
  entry: KnowledgeSelectionSnapshot["entries"][number],
): CandidateKnowledgeRetrievalScopeInput {
  const sources = entry.sources
    .map((source) => ({
      storeId: entry.storeId,
      knowledgeBaseId: entry.knowledgeBaseId,
      sourceId: source.sourceId,
      versionId: source.versionId,
    }))
    .sort((left, right) => lexicalCompare(lexicalReferenceKey(left), lexicalReferenceKey(right)));
  return { sources };
}

function lexicalHitKey(hit: CandidateKnowledgeLexicalHit): string {
  return `${lexicalReferenceKey(hit.metadata.provenance)}\u0000${hit.chunkId}`;
}

function aggregateCandidateKnowledgeRetrievalStatus(
  diagnostics: readonly CandidateKnowledgeRetrievalDiagnostic[],
  hitCount: number,
): CandidateKnowledgeRetrievalStatus {
  if (hitCount > 0) {
    return diagnostics.some((diagnostic) => diagnostic.status === "matched")
      ? "matched"
      : "bounded-fallback";
  }
  if (diagnostics.some((diagnostic) => diagnostic.status === "not-indexed")) {
    return "not-indexed";
  }
  if (diagnostics.some((diagnostic) => diagnostic.status === "stale")) return "stale";
  if (diagnostics.some((diagnostic) => diagnostic.status === "bounded-fallback")) {
    return "bounded-fallback";
  }
  if (diagnostics.every((diagnostic) => diagnostic.status === "no-query")) return "no-query";
  return "matched";
}

function selectionSnapshotsMatch(
  left: KnowledgeSelectionSnapshot,
  right: KnowledgeSelectionSnapshot,
): boolean {
  return (
    left.schemaVersion === right.schemaVersion &&
    JSON.stringify(left.entries) === JSON.stringify(right.entries)
  );
}

function validatedQueryLimit(query: CandidateKnowledgeBatchQuery): number {
  if (
    !candidateKnowledgeRetrievalPurposes.includes(query.purpose) ||
    typeof query.query !== "string" ||
    query.query.length > maximumCandidateKnowledgeRetrievalQueryLength
  ) {
    throw lexicalRetrievalFailure();
  }
  const limit = query.limit ?? 20;
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > maximumCandidateKnowledgeRetrievalChunkCount
  ) {
    throw lexicalRetrievalFailure();
  }
  return limit;
}

export function createCandidateKnowledgeLexicalQueryRuntime(
  dependencies: CandidateKnowledgeQueryBatchDependencies,
): CandidateKnowledgeLexicalQueryRuntime {
  const normalizeSelectionCommand = (
    command: RebuildCandidateKnowledgeLexicalIndexesCommand,
  ): CreateKnowledgeSelectionSnapshotCommand => {
    if (!Array.isArray(command.selections) || command.selections.length === 0) {
      throw lexicalIndexFailure();
    }
    const selections = command.selections.map((selection) => ({
      storeRoot: dependencies.requireStoreRoot(selection.storeRoot),
      knowledgeBaseId: dependencies.requireText(
        selection.knowledgeBaseId,
        "Candidate knowledge base id",
      ),
    }));
    return {
      selections,
      ...(command.combinationApproved === undefined
        ? {}
        : { combinationApproved: command.combinationApproved }),
    };
  };

  const mapSynchronizationFailure = (error: unknown): Error => {
    if (error instanceof StorageWriterLeaseError) return error;
    if (
      error instanceof Error &&
      (error.message === lexicalIndexFailure().message ||
        error.message === lexicalSelectionChangedFailure().message)
    ) {
      return error;
    }
    return lexicalIndexFailure();
  };

  const synchronizeSelection = async (
    command: RebuildCandidateKnowledgeLexicalIndexesCommand,
    reuseCurrent: boolean,
  ): Promise<SynchronizedSelection> => {
    try {
      const selectionCommand = normalizeSelectionCommand(command);
      const snapshot = await dependencies.createSnapshot(selectionCommand);
      const createdAt = command.createdAt ?? dependencies.now();
      const prepared: PreparedCandidateKnowledgeLexicalSelection[] = [];
      for (const selection of selectionCommand.selections) {
        const indexed = await dependencies.useWriterHandle(
          "ckb-lexical-rebuild",
          () => dependencies.open(selection.storeRoot),
          (handle) =>
            synchronizeCandidateKnowledgeLexicalSelection({
              handle,
              selection,
              snapshot,
              scopeForEntry: lexicalScopeForEntry,
              ingestBytes: dependencies.ingestBytes,
              createdAt,
              reuseCurrent,
              indexFailure: lexicalIndexFailure,
              selectionChangedFailure: lexicalSelectionChangedFailure,
            }),
        );
        prepared.push(indexed);
      }
      const refreshedSnapshot = await dependencies.createSnapshot(selectionCommand);
      if (!selectionSnapshotsMatch(snapshot, refreshedSnapshot)) {
        throw lexicalSelectionChangedFailure();
      }
      prepared.sort(
        (left, right) =>
          lexicalCompare(left.entry.storeId, right.entry.storeId) ||
          lexicalCompare(left.entry.knowledgeBaseId, right.entry.knowledgeBaseId),
      );
      return { prepared: Object.freeze(prepared), snapshot, selectionCommand };
    } catch (error) {
      throw mapSynchronizationFailure(error);
    }
  };

  const synchronize: CandidateKnowledgeLexicalQueryRuntime["synchronize"] = async (
    command,
    reuseCurrent,
  ) => (await synchronizeSelection(command, reuseCurrent)).prepared;

  const queryPrepared = async (
    prepared: readonly PreparedCandidateKnowledgeLexicalSelection[],
    command: CandidateKnowledgeBatchQuery,
    limit: number,
  ): Promise<CandidateKnowledgeRetrievalResult> => {
    const queried: Array<{
      readonly prepared: PreparedCandidateKnowledgeLexicalSelection;
      readonly result: CandidateKnowledgeLexicalRetrievalResult;
    }> = [];
    for (const target of prepared) {
      const result = await dependencies.useHandle(
        () => dependencies.open(target.selection.storeRoot),
        async (handle) => {
          if (handle.descriptor.id !== target.entry.storeId) {
            throw lexicalSelectionChangedFailure();
          }
          const queriedResult = await handle.queryCandidateKnowledge({
            purpose: command.purpose,
            query: command.query,
            scope: target.scope,
            limit,
          });
          if (
            JSON.stringify(queriedResult.scope) !== JSON.stringify(target.scope) ||
            (queriedResult.index !== null &&
              queriedResult.index.schemaVersion !== target.index.index.schemaVersion) ||
            (queriedResult.index !== null &&
              queriedResult.index.manifestChecksum !== target.index.index.manifestChecksum)
          ) {
            throw lexicalSelectionChangedFailure();
          }
          return queriedResult;
        },
      );
      queried.push({ prepared: target, result });
    }

    const diagnostics = queried
      .map(({ prepared: target, result }) => ({
        storeId: target.entry.storeId,
        knowledgeBaseId: target.entry.knowledgeBaseId,
        scope: result.scope,
        status: result.status,
        indexedChunkCount: result.indexedChunkCount,
        selectedChunkCount: result.selectedChunkCount,
        selectedSourceCount: result.selectedSourceCount,
        index: result.index,
        selectedChunks: result.hits.map(({ chunkId, bm25Rank }) => ({ chunkId, bm25Rank })),
      }))
      .sort(
        (left, right) =>
          lexicalCompare(left.storeId, right.storeId) ||
          lexicalCompare(left.knowledgeBaseId, right.knowledgeBaseId),
      );
    const candidates = queried.flatMap(({ result }) =>
      result.hits.map((hit, rank) => ({
        hit,
        fusedRank: -(1 / (60 + rank + 1)),
        key: lexicalHitKey(hit),
      })),
    );
    candidates.sort(
      (left, right) => left.fusedRank - right.fusedRank || lexicalCompare(left.key, right.key),
    );
    const hits = candidates.slice(0, limit).map(({ hit, fusedRank }) => ({
      ...hit,
      bm25Rank: fusedRank,
    }));
    const selectedSourceCount = new Set(
      hits.map((hit) => lexicalReferenceKey(hit.metadata.provenance)),
    ).size;
    const result: CandidateKnowledgeRetrievalResult = {
      status: aggregateCandidateKnowledgeRetrievalStatus(diagnostics, hits.length),
      indexedChunkCount: queried.reduce(
        (total, { result: queriedResult }) => total + queriedResult.indexedChunkCount,
        0,
      ),
      selectedChunkCount: hits.length,
      selectedSourceCount,
      hits,
      diagnostics,
    };
    return Object.freeze({
      ...result,
      hits: Object.freeze([...result.hits]),
      diagnostics: Object.freeze(
        diagnostics.map((diagnostic) =>
          Object.freeze({
            ...diagnostic,
            selectedChunks: Object.freeze([...diagnostic.selectedChunks]),
          }),
        ),
      ),
    });
  };

  const createBatch = (
    command: RebuildCandidateKnowledgeLexicalIndexesCommand,
  ): CandidateKnowledgeQueryBatch => {
    let synchronized: Promise<SynchronizedSelection> | undefined;
    return {
      query: async (query) => {
        try {
          const limit = validatedQueryLimit(query);
          synchronized ??= synchronizeSelection(command, true);
          const { prepared } = await synchronized;
          return await queryPrepared(prepared, query, limit);
        } catch (error) {
          if (error instanceof StorageWriterLeaseError) throw error;
          if (
            error instanceof Error &&
            (error.message === lexicalRetrievalFailure().message ||
              error.message === lexicalIndexFailure().message ||
              error.message === lexicalSelectionChangedFailure().message)
          ) {
            throw error;
          }
          throw lexicalRetrievalFailure();
        }
      },
      verify: async () => {
        if (synchronized === undefined) return;
        try {
          const { snapshot, selectionCommand } = await synchronized;
          const current = await dependencies.createSnapshot(selectionCommand);
          if (!selectionSnapshotsMatch(snapshot, current)) throw lexicalSelectionChangedFailure();
        } catch (error) {
          throw mapSynchronizationFailure(error);
        }
      },
    };
  };

  return {
    synchronize,
    createBatch,
    // A standalone query is a one-query batch; its preparation already verified the selection.
    query: (command) =>
      createBatch(command).query({
        purpose: command.purpose,
        query: command.query,
        ...(command.limit === undefined ? {} : { limit: command.limit }),
      }),
  };
}
