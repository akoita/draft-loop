import type { BlobStoragePort } from "@draft-loop/storage";
import { StorageValidationError } from "@draft-loop/storage/errors";
import type { CandidateKnowledgeStoreHandle } from "@draft-loop/storage/knowledge-store";
import { runOnlyCandidateKnowledgeStore } from "@draft-loop/storage/run-knowledge-store";
import type { PostgresTenantStorage } from "./postgres-storage.js";

export interface PostgresCandidateKnowledgeStoreOptions {
  /** One tenant's open storage. The store borrows it: closing the store leaves it open. */
  readonly storage: PostgresTenantStorage;
  /** Where managed source bytes live, such as the tenant's Cloud Storage prefix. */
  readonly blobs: BlobStoragePort;
  readonly storeId: string;
}

/**
 * Opens one tenant's candidate knowledge store for runs (ADR 0011, D3, D11): records and
 * projections from Postgres, source bytes from blob storage checked against the version's recorded
 * checksum and size. It offers a run's operations only; intake and every local-only operation
 * refuse (see `runOnlyCandidateKnowledgeStore`).
 */
export async function openPostgresCandidateKnowledgeStore(
  options: PostgresCandidateKnowledgeStoreOptions,
): Promise<CandidateKnowledgeStoreHandle> {
  const { storage, blobs } = options;
  const descriptor = await storage.getCandidateKnowledgeStore(options.storeId);
  if (descriptor === undefined) {
    throw new StorageValidationError(`candidate knowledge store ${options.storeId} was not found`);
  }
  const vectors = storage.candidateKnowledgeVectorIndex;
  return runOnlyCandidateKnowledgeStore({
    descriptor,
    close: async () => undefined,
    // Each lexical and vector write already holds its index's advisory lock for its transaction.
    withWriterLease: (_operation, callback) => callback(),
    getCandidateKnowledgeBaseLifecycleReadiness:
      storage.getCandidateKnowledgeBaseLifecycleReadiness,
    getCandidateKnowledgeSourceSensitivityRules:
      storage.getCandidateKnowledgeSourceSensitivityRules,
    readManagedCandidateKnowledgeSourceVersion: async (knowledgeBaseId, sourceId, versionId) => {
      const managed = await storage.getManagedCandidateKnowledgeSourceVersion(
        knowledgeBaseId,
        sourceId,
        versionId,
      );
      if (managed === undefined) return undefined;
      const { metadata } = managed;
      const bytes = await blobs.get({
        location: managed.location,
        checksum: metadata.checksum,
        sizeBytes: metadata.sizeBytes,
      });
      if (bytes === undefined || bytes.byteLength !== metadata.sizeBytes) {
        throw new StorageValidationError(
          "A managed candidate knowledge source version is missing or does not match its checksum.",
        );
      }
      return Object.freeze({ metadata, bytes });
    },
    inspectCandidateKnowledgeLexicalIndex: storage.inspectCandidateKnowledgeLexicalIndex,
    queryCandidateKnowledge: storage.queryCandidateKnowledge,
    rebuildCandidateKnowledgeLexicalIndex: storage.rebuildCandidateKnowledgeLexicalIndex,
    inspectCandidateKnowledgeVectorIndex: vectors.inspectCandidateKnowledgeVectorIndex,
    queryCandidateKnowledgeVectors: vectors.queryCandidateKnowledgeVectors,
    upsertCandidateKnowledgeVectors: vectors.upsertCandidateKnowledgeVectors,
    deleteCandidateKnowledgeVectorIndex: vectors.deleteCandidateKnowledgeVectorIndex,
  });
}
