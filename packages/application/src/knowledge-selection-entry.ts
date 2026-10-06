import type { CandidateKnowledgeSelectionSnapshotEntryInput } from "@draft-loop/domain";

import type { KnowledgeBaseLifecycleReadinessResult } from "./knowledge-base.js";

/**
 * Projects a knowledge base's lifecycle readiness into one selection snapshot entry.
 *
 * Retiring a source means "stop using it while preserving its evidence", so retired sources are
 * omitted from the entry and never reach retrieval, profile derivation, or run evidence. Readiness
 * keeps reporting them as blocked. Any other blocked source, an inactive knowledge base, or having
 * no ready source left still refuses the selection.
 */
export function toKnowledgeSelectionSnapshotEntry(
  storeId: string,
  readiness: KnowledgeBaseLifecycleReadinessResult,
  invariantFailure: () => Error,
): CandidateKnowledgeSelectionSnapshotEntryInput {
  if (readiness.state !== "active") throw invariantFailure();
  const selectable = readiness.sources.filter(
    (source) => source.lifecycleRevision.retirement === null,
  );
  if (selectable.length === 0 || selectable.some((source) => source.status !== "ready")) {
    throw invariantFailure();
  }
  return {
    storeId,
    knowledgeBaseId: readiness.knowledgeBaseId,
    sources: selectable.map((source) => ({
      sourceId: source.sourceId,
      versionId: source.latestVersionId,
      lifecycleRevision: source.lifecycleRevision,
    })),
  };
}
