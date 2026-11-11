import type { CanonicalCandidateProfile, ContextSnapshot } from "@draft-loop/domain";
import { factUsageAllows, resolveFactUsage } from "@draft-loop/domain/fact-usage";

import type { CandidateKnowledgeSensitivityExclusions } from "./candidate-knowledge-sensitivity-exclusion.js";
import { readFactUsage } from "./fact-usage.js";
import type { CandidateKnowledgeRetrievalResult } from "./knowledge-base.js";
import {
  type ProfileFactEvidenceCandidatesRequest,
  profileFactEvidenceCandidates,
} from "./profile-fact-evidence.js";

/**
 * Keeps held-back facts out of a CV run (#2304).
 *
 * A fact the person marked `interview-only` or `never-say` must not reach the CV author, neither
 * as a profile fact nor as the source text it was read from. Each such fact's quotes are located
 * in the run's pinned source versions, and every chunk that overlaps one is dropped before
 * selection, tracing or sending. A profile fact is only offered when its quote is found in the
 * remaining chunks, so the held-back fact, and any other fact quoted from the same chunk, is left
 * out with it. Withholding the whole chunk is deliberate: part of a chunk cannot be sent safely.
 *
 * The usage levels are read once, when the run starts or resumes, like the evidence mode. A
 * held-back fact whose quote is not found in a pinned source has no source text to withhold.
 */

interface LineRange {
  readonly first: number;
  readonly last: number;
}

interface SourceVersionKeyParts {
  readonly storeId: string;
  readonly knowledgeBaseId: string;
  readonly sourceId: string;
  readonly versionId: string;
}

interface ChunkLike {
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly metadata: { readonly provenance: SourceVersionKeyParts };
}

function referenceKey(reference: SourceVersionKeyParts): string {
  return JSON.stringify([
    reference.storeId,
    reference.knowledgeBaseId,
    reference.sourceId,
    reference.versionId,
  ]);
}

export interface RunFactUsageExclusionsRequest {
  readonly root: string;
  readonly workspaceId: string;
  readonly context: Pick<ContextSnapshot, "evidenceManifest">;
  /** The run's pinned, verified reviewed profile. */
  readonly profile: Pick<CanonicalCandidateProfile, "id" | "version" | "facts">;
  /** The run's withheld-section filter, which stays in force. */
  readonly withheld: CandidateKnowledgeSensitivityExclusions;
  /** Loads the chunks of exact pinned source versions, before any filter. */
  readonly loadSourceChunks: ProfileFactEvidenceCandidatesRequest["loadSourceChunks"];
}

/**
 * The run's chunk filter with the held-back facts' source text withheld too, or the given filter
 * unchanged when no fact of the profile is held back from a CV.
 */
export async function withFactUsageExclusions(
  request: RunFactUsageExclusionsRequest,
): Promise<CandidateKnowledgeSensitivityExclusions> {
  const { withheld } = request;
  const usage = await readFactUsage(request.root);
  const heldBack = request.profile.facts.filter(
    (fact) => !factUsageAllows(resolveFactUsage(usage, fact), "cv"),
  );
  if (heldBack.length === 0) return withheld;

  // One pseudo-fact per quote, so every place a held-back fact was read from is located.
  const located = await profileFactEvidenceCandidates({
    profile: {
      id: request.profile.id,
      version: request.profile.version,
      facts: heldBack.flatMap((fact) =>
        fact.provenance.map((reference, index) => ({
          ...fact,
          id: `${fact.id}#${index}`,
          provenance: [reference],
        })),
      ),
    },
    workspaceId: request.workspaceId,
    manifestSourceIds: new Set(request.context.evidenceManifest.map(({ id }) => id)),
    loadSourceChunks: async (references) =>
      withheld.filterChunks(await request.loadSourceChunks(references)),
  });
  const ranges = new Map<string, LineRange[]>();
  for (const { item, provenance } of located) {
    const key = referenceKey(provenance);
    const range = { first: item.lineStart, last: item.lineEnd };
    const existing = ranges.get(key);
    if (existing === undefined) ranges.set(key, [range]);
    else existing.push(range);
  }
  if (ranges.size === 0) return withheld;

  const heldBackChunk = (chunk: ChunkLike): boolean =>
    (ranges.get(referenceKey(chunk.metadata.provenance)) ?? []).some(
      (range) => chunk.lineStart <= range.last && range.first <= chunk.lineEnd,
    );

  return {
    filterChunks: async (chunks) =>
      (await withheld.filterChunks(chunks)).filter((chunk) => !heldBackChunk(chunk)),
    filterResult: async (result) => withoutHits(await withheld.filterResult(result), heldBackChunk),
    assertRequestClean: (input) => withheld.assertRequestClean(input),
  };
}

/** The result without the hits the predicate names, with its counts and diagnostics consistent. */
function withoutHits(
  result: CandidateKnowledgeRetrievalResult,
  drop: (hit: CandidateKnowledgeRetrievalResult["hits"][number]) => boolean,
): CandidateKnowledgeRetrievalResult {
  const dropped = new Set<string>(result.hits.filter(drop).map(({ chunkId }) => chunkId));
  if (dropped.size === 0) return result;
  const hits = result.hits.filter(({ chunkId }) => !dropped.has(chunkId));
  const sourceCount = (scope: typeof hits) =>
    new Set(scope.map((hit) => referenceKey(hit.metadata.provenance))).size;
  return Object.freeze({
    ...result,
    selectedChunkCount: hits.length,
    selectedSourceCount: sourceCount(hits),
    hits: Object.freeze(hits),
    diagnostics: Object.freeze(
      result.diagnostics.map((diagnostic) => {
        const selectedChunks = diagnostic.selectedChunks.filter(
          ({ chunkId }) => !dropped.has(chunkId),
        );
        const scopeHits = hits.filter(
          (hit) =>
            hit.metadata.provenance.storeId === diagnostic.storeId &&
            hit.metadata.provenance.knowledgeBaseId === diagnostic.knowledgeBaseId,
        );
        return Object.freeze({
          ...diagnostic,
          selectedChunkCount: selectedChunks.length,
          selectedSourceCount: sourceCount(scopeHits),
          selectedChunks: Object.freeze(selectedChunks),
        });
      }),
    ),
  });
}
