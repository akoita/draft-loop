import type { WorkspaceHistoryStorage } from "@draft-loop/storage";
import { StorageUnavailableError } from "@draft-loop/storage/errors";
import type { PostgresStorage } from "./postgres-storage.js";

function unavailable(operation: string): () => Promise<never> {
  return () =>
    Promise.reject(
      new StorageUnavailableError(`${operation} is not available in the hosted service.`),
    );
}

/**
 * One tenant's Postgres storage as a workspace history for the hosted application driver. The
 * storage is shared by every call, so closing the history leaves it open. The legacy local
 * evidence folder and its chronology have no hosted counterpart, so they refuse: hosted runs take
 * their evidence from candidate knowledge bases. Semantic retrieval
 * traces refuse until hosted semantic retrieval exists.
 */
export function hostedWorkspaceHistory(storage: PostgresStorage): WorkspaceHistoryStorage {
  return {
    ...storage,
    close: async () => undefined,
    saveEvidenceSource: unavailable("Local evidence"),
    getEvidenceSource: unavailable("Local evidence"),
    saveEvidenceChunk: unavailable("Local evidence"),
    inspectEvidenceRetrieval: unavailable("Local evidence"),
    queryEvidence: unavailable("Local evidence"),
    readApprovedChronology: unavailable("Local evidence"),
    candidateKnowledgeSemanticRetrievalTrace: {
      appendSemanticRetrievalTrace: unavailable("Semantic retrieval"),
      getSemanticRetrievalTrace: unavailable("Semantic retrieval"),
    },
  };
}
