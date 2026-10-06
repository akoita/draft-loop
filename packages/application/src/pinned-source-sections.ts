import type { CandidateKnowledgeSelectionSnapshot } from "@draft-loop/domain";
import {
  type ClassifiedSourceSection,
  classifySourceSections,
} from "@draft-loop/domain/source-sensitivity";
import { ingestBytes as defaultIngestBytes } from "@draft-loop/ingestion";
import type { CandidateKnowledgeStoreHandle } from "@draft-loop/storage/knowledge-store";

/** One pinned source version split into classified sections under its knowledge base's rules. */
export interface PinnedSourceSections {
  readonly sourceId: string;
  readonly versionId: string;
  /** Only Markdown is sectioned; any other media type has no sections. */
  readonly text: string;
  readonly sections: readonly ClassifiedSourceSection[];
}

type SnapshotEntry = CandidateKnowledgeSelectionSnapshot["entries"][number];

/**
 * Open the store that holds a pinned snapshot entry. The binding list only gives roots, so the
 * store identity must match the pinned one. Throws when no binding resolves it.
 */
export async function openPinnedEntryStore(
  bindings: readonly { readonly storeRoot: string; readonly knowledgeBaseId: string }[],
  entry: SnapshotEntry,
  open: (storeRoot: string) => Promise<CandidateKnowledgeStoreHandle>,
): Promise<CandidateKnowledgeStoreHandle> {
  for (const binding of bindings) {
    if (binding.knowledgeBaseId !== entry.knowledgeBaseId) continue;
    let handle: CandidateKnowledgeStoreHandle | undefined;
    try {
      handle = await open(binding.storeRoot);
    } catch {
      continue;
    }
    if (handle.descriptor.id === entry.storeId) return handle;
    await handle.close().catch(() => undefined);
  }
  throw new Error("The pinned knowledge store is unavailable.");
}

/**
 * Classify every pinned source of one snapshot entry. Returns undefined when the knowledge base
 * has no rules (every section is normal). Throws when a pinned version cannot be read as text.
 */
export async function readPinnedEntrySections(
  handle: CandidateKnowledgeStoreHandle,
  entry: SnapshotEntry,
  ingest: typeof defaultIngestBytes = defaultIngestBytes,
): Promise<readonly PinnedSourceSections[] | undefined> {
  const rules = await handle.getCandidateKnowledgeSourceSensitivityRules(entry.knowledgeBaseId);
  if (rules === undefined || rules.rules.length === 0) return undefined;
  const sources: PinnedSourceSections[] = [];
  for (const selected of entry.sources) {
    const content = await handle.readManagedCandidateKnowledgeSourceVersion(
      entry.knowledgeBaseId,
      selected.sourceId,
      selected.versionId,
    );
    if (content === undefined) throw new Error("A pinned source version is unavailable.");
    const ingested = await ingest(
      { path: "sensitivity-exclusion", mediaType: content.metadata.mediaType },
      content.bytes,
      { maxSourceBytes: content.metadata.sizeBytes || 1 },
    );
    const source = ingested.source;
    if (source === null || ingested.issues.length > 0 || source.issues.length > 0) {
      throw new Error("A pinned source version could not be read as text.");
    }
    sources.push({
      sourceId: selected.sourceId,
      versionId: selected.versionId,
      text: source.text,
      sections:
        source.mediaType === "text/markdown"
          ? classifySourceSections(source.text, rules.rules)
          : [],
    });
  }
  return sources;
}
