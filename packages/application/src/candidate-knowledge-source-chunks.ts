import { createHash } from "node:crypto";

import type {
  CandidateKnowledgeLexicalChunkInput,
  CandidateKnowledgeSelectionSnapshotEntry,
} from "@draft-loop/domain";
import {
  maximumCandidateKnowledgeRetrievalChunkTextLength,
  maximumCandidateKnowledgeRetrievalIndexedChunkCount,
} from "@draft-loop/domain";
import { ingestBytes as defaultIngestBytes } from "@draft-loop/ingestion";
import type { CandidateKnowledgeStoreHandle } from "@draft-loop/storage/knowledge-store";

/** Stable digest used by the pinned-source lexical projection. */
export function lexicalDigest(parts: readonly (string | number)[]): string {
  return createHash("sha256").update(JSON.stringify(parts), "utf8").digest("hex");
}

/** Re-derive lexical chunks only from the exact managed versions in a pinned entry. */
export async function deriveCandidateKnowledgeLexicalChunks(
  handle: CandidateKnowledgeStoreHandle,
  entry: CandidateKnowledgeSelectionSnapshotEntry,
  ingest: typeof defaultIngestBytes = defaultIngestBytes,
  failureFactory: () => Error = () =>
    new Error("The candidate knowledge lexical index could not be synchronized."),
): Promise<readonly CandidateKnowledgeLexicalChunkInput[]> {
  const chunks: CandidateKnowledgeLexicalChunkInput[] = [];
  for (const selectedSource of entry.sources) {
    const reference = {
      storeId: entry.storeId,
      knowledgeBaseId: entry.knowledgeBaseId,
      sourceId: selectedSource.sourceId,
      versionId: selectedSource.versionId,
    };
    const content = await handle.readManagedCandidateKnowledgeSourceVersion(
      entry.knowledgeBaseId,
      selectedSource.sourceId,
      selectedSource.versionId,
    );
    if (
      content === undefined ||
      content.metadata.knowledgeBaseId !== entry.knowledgeBaseId ||
      content.metadata.sourceId !== selectedSource.sourceId ||
      content.metadata.id !== selectedSource.versionId ||
      content.metadata.id !== selectedSource.lifecycleRevision.versionId ||
      content.metadata.version !== selectedSource.lifecycleRevision.version ||
      content.metadata.createdAt !== selectedSource.lifecycleRevision.createdAt ||
      selectedSource.lifecycleRevision.managed !== true ||
      content.bytes.byteLength !== content.metadata.sizeBytes ||
      createHash("sha256").update(content.bytes).digest("hex") !== content.metadata.checksum
    ) {
      throw failureFactory();
    }

    const normalized = await ingest(
      {
        // A logical identifier is consumed only by the byte normalizer; no local path or URL
        // enters the lexical projection.
        path: `candidate-knowledge-${lexicalDigest([
          reference.storeId,
          reference.knowledgeBaseId,
          reference.sourceId,
          reference.versionId,
        ])}`,
        mediaType: content.metadata.mediaType,
      },
      content.bytes,
      {
        maxChunkCharacters: maximumCandidateKnowledgeRetrievalChunkTextLength,
        maxSourceBytes: Math.max(1, content.metadata.sizeBytes),
      },
    );
    if (
      normalized.source === null ||
      normalized.issues.length > 0 ||
      normalized.source.issues.length > 0 ||
      normalized.source.checksum !== content.metadata.checksum ||
      normalized.source.sizeBytes !== content.metadata.sizeBytes ||
      normalized.source.chunks.length === 0
    ) {
      throw failureFactory();
    }
    for (const [ordinal, chunk] of normalized.source.chunks.entries()) {
      if (
        chunk.text.trim() === "" ||
        chunk.text.length > maximumCandidateKnowledgeRetrievalChunkTextLength
      ) {
        throw failureFactory();
      }
      chunks.push({
        chunkId: lexicalDigest([
          "candidate-knowledge-lexical-v1",
          reference.storeId,
          reference.knowledgeBaseId,
          reference.sourceId,
          reference.versionId,
          ordinal,
          chunk.text,
        ]),
        ordinal,
        lineStart: chunk.locator.lineStart,
        lineEnd: chunk.locator.lineEnd,
        text: chunk.text,
        metadata: { provenance: reference },
      });
      if (chunks.length > maximumCandidateKnowledgeRetrievalIndexedChunkCount) {
        throw failureFactory();
      }
    }
  }
  if (chunks.length === 0) throw failureFactory();
  return chunks;
}
