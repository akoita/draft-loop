import type { CandidateKnowledgeRetrievalScopeInput } from "@draft-loop/domain";
import type { ingestBytes } from "@draft-loop/ingestion";
import type { CandidateKnowledgeLexicalIndexRecord } from "@draft-loop/storage";
import { computeCandidateKnowledgeLexicalManifestChecksum } from "@draft-loop/storage";
import type { CandidateKnowledgeStoreHandle } from "@draft-loop/storage/knowledge-store";
import { deriveCandidateKnowledgeLexicalChunks } from "./candidate-knowledge-source-chunks.js";
import type {
  CreateKnowledgeSelectionSnapshotSelection,
  KnowledgeSelectionSnapshot,
} from "./knowledge-base.js";

const candidateKnowledgeLexicalIndexerId = "ingestion-lexical-v1";

type SnapshotEntry = KnowledgeSelectionSnapshot["entries"][number];

/** A current lexical projection for one selection; `rebuilt` is set only when this call rebuilt it. */
export interface PreparedCandidateKnowledgeLexicalSelection {
  readonly selection: CreateKnowledgeSelectionSnapshotSelection;
  readonly entry: SnapshotEntry;
  readonly scope: CandidateKnowledgeRetrievalScopeInput;
  readonly index: Omit<CandidateKnowledgeLexicalIndexRecord, "createdAt">;
  readonly rebuilt: CandidateKnowledgeLexicalIndexRecord | undefined;
}

export interface CandidateKnowledgeLexicalSelectionSyncRequest {
  readonly handle: CandidateKnowledgeStoreHandle;
  readonly selection: CreateKnowledgeSelectionSnapshotSelection;
  readonly snapshot: KnowledgeSelectionSnapshot;
  readonly scopeForEntry: (entry: SnapshotEntry) => CandidateKnowledgeRetrievalScopeInput;
  readonly ingestBytes: typeof ingestBytes;
  readonly createdAt: string;
  /**
   * Reuse an already current projection instead of re-deriving and rebuilding it. The projection
   * is fully determined by the exact immutable source versions and the indexer identity, both
   * bound by the manifest checksum, so a matching manifest is a current projection.
   */
  readonly reuseCurrent: boolean;
  readonly indexFailure: () => Error;
  readonly selectionChangedFailure: () => Error;
}

/** Bring one selection's lexical projection up to date, rebuilding only when it is not current. */
export async function synchronizeCandidateKnowledgeLexicalSelection(
  request: CandidateKnowledgeLexicalSelectionSyncRequest,
): Promise<PreparedCandidateKnowledgeLexicalSelection> {
  const { handle, selection, snapshot } = request;
  const entry = snapshot.entries.find(
    (candidate) =>
      candidate.storeId === handle.descriptor.id &&
      candidate.knowledgeBaseId === selection.knowledgeBaseId,
  );
  if (entry === undefined) throw request.selectionChangedFailure();
  const scope = request.scopeForEntry(entry);
  const indexIdentity = {
    schemaVersion: 1,
    indexerId: candidateKnowledgeLexicalIndexerId,
    manifestChecksum: computeCandidateKnowledgeLexicalManifestChecksum(scope),
  };
  if (request.reuseCurrent) {
    const inspection = await handle.inspectCandidateKnowledgeLexicalIndex(scope, indexIdentity);
    if (
      inspection.status === "matched" &&
      inspection.index !== null &&
      inspection.indexedScope !== null &&
      JSON.stringify(inspection.indexedScope) === JSON.stringify(scope) &&
      inspection.index.schemaVersion === indexIdentity.schemaVersion &&
      inspection.index.indexerId === indexIdentity.indexerId &&
      inspection.index.manifestChecksum === indexIdentity.manifestChecksum &&
      inspection.indexedChunkCount > 0
    ) {
      return {
        selection,
        entry,
        scope,
        index: {
          scope: inspection.indexedScope,
          index: inspection.index,
          indexedChunkCount: inspection.indexedChunkCount,
          stale: false,
        },
        rebuilt: undefined,
      };
    }
  }
  const chunks = await deriveCandidateKnowledgeLexicalChunks(
    handle,
    entry,
    request.ingestBytes,
    request.indexFailure,
  );
  const index = await handle.rebuildCandidateKnowledgeLexicalIndex({
    scope,
    index: indexIdentity,
    chunks,
    createdAt: request.createdAt,
  });
  if (
    JSON.stringify(index.scope) !== JSON.stringify(scope) ||
    index.index.schemaVersion !== indexIdentity.schemaVersion ||
    index.index.indexerId !== indexIdentity.indexerId ||
    index.index.manifestChecksum !== indexIdentity.manifestChecksum ||
    index.indexedChunkCount !== chunks.length ||
    index.stale
  ) {
    throw request.indexFailure();
  }
  return { selection, entry, scope, index, rebuilt: index };
}
