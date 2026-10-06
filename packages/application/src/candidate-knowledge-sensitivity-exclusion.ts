import type { CandidateKnowledgeSelectionSnapshot, ContextSnapshot } from "@draft-loop/domain";
import {
  classifySourceSections,
  type SourceSensitivityTier,
} from "@draft-loop/domain/source-sensitivity";
import { ingestBytes as defaultIngestBytes } from "@draft-loop/ingestion";
import type { JsonObject, ModelRequest, ModelResponse } from "@draft-loop/providers";
import {
  type CandidateKnowledgeStoreHandle,
  openCandidateKnowledgeStore as defaultOpenCandidateKnowledgeStore,
} from "@draft-loop/storage/knowledge-store";

import { canonicalProfileExcludedSensitivityTiers } from "./canonical-profile-sensitivity-filter.js";
import { CliUserError } from "./cli-user-error.js";
import type { CandidateKnowledgeRetrievalResult } from "./knowledge-base.js";

/**
 * Keeps withheld source sections out of a review run.
 *
 * Retrieval chunks that overlap a section the knowledge base's current rules withhold are dropped
 * before they can be selected, traced or sent. A second, independent check refuses any author or
 * critic request that still contains a distinctive line of a withheld section. Both use the same
 * tier policy as profile derivation, so consent (#892) changes it in one place. Everything here
 * fails closed: rules or source text that cannot be read stop the run.
 */

/** Chunk line numbers are 1-based and inclusive, like the ingestion locators. */
interface ExcludedLineRange {
  readonly first: number;
  readonly last: number;
}

interface SourceVersionReference {
  readonly storeId: string;
  readonly knowledgeBaseId: string;
  readonly sourceId: string;
  readonly versionId: string;
}

interface ChunkLike {
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly metadata: { readonly provenance: SourceVersionReference };
}

interface BindingLike {
  readonly storeRoot: string;
  readonly knowledgeBaseId: string;
}

export interface CandidateKnowledgeSensitivityExclusions {
  /** Drop every chunk that overlaps a withheld section; any overlap counts. */
  readonly filterChunks: <T extends ChunkLike>(chunks: readonly T[]) => Promise<readonly T[]>;
  /** The same for a query result, with counts and diagnostics kept consistent. */
  readonly filterResult: (
    result: CandidateKnowledgeRetrievalResult,
  ) => Promise<CandidateKnowledgeRetrievalResult>;
  /** Throws a fixed, content-free error when the request contains withheld text. */
  readonly assertRequestClean: (input: unknown) => Promise<void>;
}

export interface CandidateKnowledgeSensitivityExclusionDependencies {
  readonly open?: (storeRoot: string) => Promise<CandidateKnowledgeStoreHandle>;
  readonly ingestBytes?: typeof defaultIngestBytes;
  readonly excludedTiers?: ReadonlySet<SourceSensitivityTier>;
}

export const sensitivityExclusionUnavailableMessage =
  "The sensitivity rules or source text for the selected knowledge could not be read, so the run was stopped before any candidate material was sent.";
export const sensitivityRequestRefusedMessage =
  "A provider request was refused because it contained text from a source section withheld by sensitivity rules. No data was sent.";

/** Lines shorter than this are too generic to identify a withheld section. */
const minimumFingerprintLength = 24;
/** Only the start of a long line is compared, which still identifies it. */
const maximumFingerprintLength = 160;
const maximumFingerprints = 2_000;

function normalizeLine(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
}

function sourceKey(reference: SourceVersionReference): string {
  return JSON.stringify([
    reference.storeId,
    reference.knowledgeBaseId,
    reference.sourceId,
    reference.versionId,
  ]);
}

function knowledgeBaseKey(reference: {
  readonly storeId: string;
  readonly knowledgeBaseId: string;
}): string {
  return JSON.stringify([reference.storeId, reference.knowledgeBaseId]);
}

/** Line numbers (1-based) of the first and last character of `[start, end)`. */
function lineRange(text: string, start: number, end: number): ExcludedLineRange | undefined {
  if (end <= start) return undefined;
  const lineOf = (offset: number): number => text.slice(0, offset).split("\n").length;
  return { first: lineOf(start), last: lineOf(end - 1) };
}

interface ExclusionState {
  readonly knowledgeBasesWithRules: ReadonlySet<string>;
  readonly rangesBySource: ReadonlyMap<string, readonly ExcludedLineRange[]>;
  readonly fingerprints: readonly string[];
}

export function createCandidateKnowledgeSensitivityExclusions(
  bindings: readonly BindingLike[],
  snapshot: CandidateKnowledgeSelectionSnapshot,
  dependencies: CandidateKnowledgeSensitivityExclusionDependencies = {},
): CandidateKnowledgeSensitivityExclusions {
  const open = dependencies.open ?? defaultOpenCandidateKnowledgeStore;
  const ingest = dependencies.ingestBytes ?? defaultIngestBytes;
  const excludedTiers = dependencies.excludedTiers ?? canonicalProfileExcludedSensitivityTiers;

  async function openEntryStore(
    entry: CandidateKnowledgeSelectionSnapshot["entries"][number],
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

  async function compute(): Promise<ExclusionState> {
    const knowledgeBasesWithRules = new Set<string>();
    const rangesBySource = new Map<string, readonly ExcludedLineRange[]>();
    const withheldLines = new Set<string>();
    const allowedLines = new Set<string>();
    for (const entry of snapshot.entries) {
      const handle = await openEntryStore(entry);
      try {
        const rules = await handle.getCandidateKnowledgeSourceSensitivityRules(
          entry.knowledgeBaseId,
        );
        if (rules === undefined || rules.rules.length === 0) continue;
        knowledgeBasesWithRules.add(knowledgeBaseKey(entry));
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
          const ranges: ExcludedLineRange[] = [];
          if (source.mediaType === "text/markdown") {
            for (const section of classifySourceSections(source.text, rules.rules)) {
              const excluded = excludedTiers.has(section.tier);
              const range = excluded
                ? lineRange(source.text, section.start, section.end)
                : undefined;
              if (range !== undefined) ranges.push(range);
              const target = excluded ? withheldLines : allowedLines;
              for (const line of source.text.slice(section.start, section.end).split("\n")) {
                const normalized = normalizeLine(line);
                if (normalized !== "") target.add(normalized);
              }
            }
          }
          rangesBySource.set(
            sourceKey({
              storeId: entry.storeId,
              knowledgeBaseId: entry.knowledgeBaseId,
              sourceId: selected.sourceId,
              versionId: selected.versionId,
            }),
            ranges,
          );
        }
      } finally {
        await handle.close().catch(() => undefined);
      }
    }
    // A line that also appears in allowed text cannot identify withheld text.
    const fingerprints = [
      ...new Set(
        [...withheldLines]
          .filter((line) => line.length >= minimumFingerprintLength && !allowedLines.has(line))
          .map((line) => line.slice(0, maximumFingerprintLength)),
      ),
    ]
      .sort((left, right) => right.length - left.length || (left < right ? -1 : 1))
      .slice(0, maximumFingerprints);
    return { knowledgeBasesWithRules, rangesBySource, fingerprints };
  }

  let pending: Promise<ExclusionState> | undefined;
  const state = (): Promise<ExclusionState> => {
    pending ??= compute().catch(() => {
      throw new CliUserError(sensitivityExclusionUnavailableMessage);
    });
    return pending;
  };

  const isExcluded = (current: ExclusionState, chunk: ChunkLike): boolean => {
    const provenance = chunk.metadata.provenance;
    if (!current.knowledgeBasesWithRules.has(knowledgeBaseKey(provenance))) return false;
    const ranges = current.rangesBySource.get(sourceKey(provenance));
    // A chunk from a source the rules were not evaluated for cannot be shown to be safe.
    if (ranges === undefined) return true;
    return ranges.some((range) => chunk.lineStart <= range.last && range.first <= chunk.lineEnd);
  };

  return {
    filterChunks: async (chunks) => {
      const current = await state();
      return chunks.filter((chunk) => !isExcluded(current, chunk));
    },
    filterResult: async (result) => {
      const current = await state();
      const dropped = new Set<string>(
        result.hits.filter((hit) => isExcluded(current, hit)).map(({ chunkId }) => chunkId),
      );
      if (dropped.size === 0) return result;
      const hits = result.hits.filter(({ chunkId }) => !dropped.has(chunkId));
      return Object.freeze({
        ...result,
        selectedChunkCount: hits.length,
        selectedSourceCount: new Set(hits.map((hit) => sourceKey(hit.metadata.provenance))).size,
        hits: Object.freeze(hits),
        diagnostics: Object.freeze(
          result.diagnostics.map((diagnostic) => {
            const selectedChunks = diagnostic.selectedChunks.filter(
              ({ chunkId }) => !dropped.has(chunkId),
            );
            const scopeHits = hits.filter(
              (hit) => knowledgeBaseKey(hit.metadata.provenance) === knowledgeBaseKey(diagnostic),
            );
            return Object.freeze({
              ...diagnostic,
              selectedChunkCount: selectedChunks.length,
              selectedSourceCount: new Set(
                scopeHits.map((hit) => sourceKey(hit.metadata.provenance)),
              ).size,
              selectedChunks: Object.freeze(selectedChunks),
            });
          }),
        ),
      });
    },
    assertRequestClean: async (input) => {
      const { fingerprints } = await state();
      if (fingerprints.length === 0) return;
      const haystack = normalizeLine(requestStrings(input).join(" "));
      if (fingerprints.some((fingerprint) => haystack.includes(fingerprint))) {
        throw new CliUserError(sensitivityRequestRefusedMessage);
      }
    },
  };
}

/** Every string in a request, so escaping in a serialized form cannot hide a match. */
function requestStrings(value: unknown, collected: string[] = [], depth = 0): string[] {
  if (depth > 64) throw new Error("The provider request is nested too deeply to inspect.");
  if (typeof value === "string") {
    collected.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) requestStrings(item, collected, depth + 1);
  } else if (typeof value === "object" && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      collected.push(key);
      requestStrings(item, collected, depth + 1);
    }
  }
  return collected;
}

interface RequestAdapter {
  readonly execute: (request: ModelRequest<JsonObject>) => Promise<ModelResponse<JsonObject>>;
}

/**
 * Wrap provider adapters of a pinned selection so no author or critic request leaves with
 * withheld text. Without a selection the adapter is returned unchanged.
 */
export function candidateKnowledgeRequestGuard(
  config: { readonly candidateKnowledgeSelection?: { readonly entries: readonly BindingLike[] } },
  context: Pick<ContextSnapshot, "candidateKnowledgeSelection">,
  exclusions: CandidateKnowledgeSensitivityExclusions | undefined = undefined,
): <A extends RequestAdapter>(adapter: A) => RequestAdapter {
  const selection = context.candidateKnowledgeSelection;
  const binding = config.candidateKnowledgeSelection;
  const guard =
    exclusions ??
    (selection === undefined || binding === undefined
      ? undefined
      : createCandidateKnowledgeSensitivityExclusions(binding.entries, selection));
  if (guard === undefined) return (adapter) => adapter;
  return (adapter) => ({
    execute: async (request) => {
      await guard.assertRequestClean(request.input);
      return adapter.execute(request);
    },
  });
}
