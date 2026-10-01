import type {
  CandidateKnowledgeLexicalChunkInput,
  CandidateKnowledgeLexicalHit,
  CandidateKnowledgeRetrievalSourceVersionReferenceInput,
  CandidateKnowledgeSelectionSnapshot,
  CandidateKnowledgeSelectionSnapshotEntry,
} from "@draft-loop/domain";
import {
  createCandidateKnowledgeLexicalHit,
  maximumCandidateKnowledgeRetrievalChunkTextLength,
} from "@draft-loop/domain";
import { ingestBytes } from "@draft-loop/ingestion";
import {
  type CandidateKnowledgeStoreHandle,
  openCandidateKnowledgeStore,
} from "@draft-loop/storage/knowledge-store";
import { selectCandidateIndependentProjectEvidence } from "./candidate-independent-project-evidence.js";
import { parseLeadingMarkdownHeading } from "./candidate-knowledge-heading.js";
import {
  deriveCandidateKnowledgeLexicalChunks,
  lexicalDigest,
} from "./candidate-knowledge-source-chunks.js";
import {
  createCandidateRoleContributionBlock,
  flattenCandidateRoleContributionSourceLines,
  isDatedCandidateRoleHeading,
  selectCandidateRoleContributionBlocks,
} from "./candidate-role-contribution-blocks.js";

const sourceReadFailureMessage = "Pinned candidate knowledge evidence could not be verified.";
const sourceScanBudgetFailureMessage =
  "Pinned candidate knowledge scan exceeded its local text limit.";

export interface CandidateKnowledgeStoreBinding {
  readonly storeRoot: string;
  readonly knowledgeBaseId: string;
}

export interface CandidateExperienceBodyEvidenceComposition {
  readonly chronologyHits: readonly CandidateKnowledgeLexicalHit[];
  readonly requestedProjectOverflowHits: readonly CandidateKnowledgeLexicalHit[];
}

function provenanceKey(value: {
  readonly storeId: string;
  readonly knowledgeBaseId: string;
  readonly sourceId: string;
  readonly versionId: string;
}): string {
  return JSON.stringify([value.storeId, value.knowledgeBaseId, value.sourceId, value.versionId]);
}

async function closeHandle(handle: CandidateKnowledgeStoreHandle | undefined): Promise<void> {
  if (handle === undefined) return;
  try {
    await handle.close();
  } catch {
    throw new Error(sourceReadFailureMessage);
  }
}

/** Cache exact pinned-source normalization for this runtime; no origin is opened. */
export function createPinnedCandidateKnowledgeSourceReferenceChunkLoader(
  bindings: readonly CandidateKnowledgeStoreBinding[],
  snapshot: CandidateKnowledgeSelectionSnapshot,
): (
  references: readonly CandidateKnowledgeRetrievalSourceVersionReferenceInput[],
  maxSourceTextBytes?: number,
) => Promise<readonly CandidateKnowledgeLexicalChunkInput[]> {
  const cache = new Map<string, Promise<readonly CandidateKnowledgeLexicalChunkInput[]>>();

  const loadOne = (
    reference: CandidateKnowledgeRetrievalSourceVersionReferenceInput,
  ): Promise<readonly CandidateKnowledgeLexicalChunkInput[]> => {
    const key = provenanceKey(reference);
    const existing = cache.get(key);
    if (existing !== undefined) return existing;
    const pending = (async () => {
      const pinnedEntry = snapshot.entries.find(
        (entry) =>
          entry.storeId === reference.storeId &&
          entry.knowledgeBaseId === reference.knowledgeBaseId,
      );
      const pinnedSource = pinnedEntry?.sources.find(
        (source) =>
          source.sourceId === reference.sourceId && source.versionId === reference.versionId,
      );
      if (pinnedEntry === undefined || pinnedSource === undefined) {
        throw new Error(sourceReadFailureMessage);
      }

      let matchedHandle: CandidateKnowledgeStoreHandle | undefined;
      for (const binding of bindings) {
        if (binding.knowledgeBaseId !== reference.knowledgeBaseId) continue;
        let candidate: CandidateKnowledgeStoreHandle | undefined;
        try {
          candidate = await openCandidateKnowledgeStore(binding.storeRoot);
        } catch {
          continue;
        }
        if (candidate.descriptor.id === reference.storeId) {
          matchedHandle = candidate;
          break;
        }
        await closeHandle(candidate);
      }
      if (matchedHandle === undefined) throw new Error(sourceReadFailureMessage);

      try {
        const scopedEntry: CandidateKnowledgeSelectionSnapshotEntry = {
          ...pinnedEntry,
          sources: [pinnedSource],
        };
        return await deriveCandidateKnowledgeLexicalChunks(
          matchedHandle,
          scopedEntry,
          ingestBytes,
          () => new Error(sourceReadFailureMessage),
        );
      } catch {
        throw new Error(sourceReadFailureMessage);
      } finally {
        await closeHandle(matchedHandle);
      }
    })();
    cache.set(key, pending);
    return pending;
  };

  return async (references, maxSourceTextBytes) => {
    if (
      maxSourceTextBytes !== undefined &&
      (!Number.isSafeInteger(maxSourceTextBytes) || maxSourceTextBytes < 1)
    ) {
      throw new Error(sourceScanBudgetFailureMessage);
    }
    const unique = new Map<string, CandidateKnowledgeRetrievalSourceVersionReferenceInput>();
    for (const reference of references) unique.set(provenanceKey(reference), reference);
    const distinctReferences = [...unique.values()];
    if (maxSourceTextBytes === undefined) {
      const loaded = await Promise.all(distinctReferences.map(loadOne));
      return loaded.flat();
    }

    const loaded: CandidateKnowledgeLexicalChunkInput[] = [];
    let sourceTextBytes = 0;
    for (const reference of distinctReferences) {
      const chunks = await loadOne(reference);
      sourceTextBytes += chunks.reduce(
        (total, chunk) => total + Buffer.byteLength(chunk.text, "utf8"),
        0,
      );
      if (sourceTextBytes > maxSourceTextBytes) {
        throw new Error(sourceScanBudgetFailureMessage);
      }
      loaded.push(...chunks);
    }
    return loaded;
  };
}

/** Compatibility hit-loader retained for existing retrieval callers. */
export function createPinnedCandidateKnowledgeSourceChunkLoader(
  bindings: readonly CandidateKnowledgeStoreBinding[],
  snapshot: CandidateKnowledgeSelectionSnapshot,
): (
  hits: readonly CandidateKnowledgeLexicalHit[],
) => Promise<readonly CandidateKnowledgeLexicalChunkInput[]> {
  const loadReferences = createPinnedCandidateKnowledgeSourceReferenceChunkLoader(
    bindings,
    snapshot,
  );
  return (hits) => loadReferences(hits.map((hit) => hit.metadata.provenance));
}

/** Compose bounded role records and complete requested projects that overflow those records. */
export function composeCandidateExperienceBodyEvidence(
  chronologyHits: readonly CandidateKnowledgeLexicalHit[],
  sourceChunks: readonly CandidateKnowledgeLexicalChunkInput[],
  jobQuery = "",
  candidateInstructions = "",
): CandidateExperienceBodyEvidenceComposition {
  const chunksById = new Map(sourceChunks.map((chunk) => [chunk.chunkId, chunk] as const));
  const chunksBySource = new Map<string, CandidateKnowledgeLexicalChunkInput[]>();
  const requestedProjectOverflowHits: CandidateKnowledgeLexicalHit[] = [];
  for (const chunk of sourceChunks) {
    const key = provenanceKey(chunk.metadata.provenance);
    const group = chunksBySource.get(key);
    if (group === undefined) chunksBySource.set(key, [chunk]);
    else group.push(chunk);
  }
  for (const group of chunksBySource.values())
    group.sort((left, right) => left.ordinal - right.ordinal);

  const composedChronologyHits = chronologyHits.map((heading) => {
    const exact = chunksById.get(heading.chunkId);
    if (
      exact === undefined ||
      exact.text !== heading.text ||
      exact.ordinal !== heading.ordinal ||
      exact.lineStart !== heading.lineStart ||
      exact.lineEnd !== heading.lineEnd ||
      provenanceKey(exact.metadata.provenance) !== provenanceKey(heading.metadata.provenance)
    ) {
      throw new Error("Chronology heading did not match its pinned source chunk.");
    }
    const headingMatch = parseLeadingMarkdownHeading(heading.text);
    if (headingMatch === undefined) return heading;
    const headingLevel = headingMatch.level;
    const headingLineStart = exact.lineStart + headingMatch.lineIndex;
    const headingLine = flattenCandidateRoleContributionSourceLines([exact])?.find(
      (line) => line.lineNumber === headingLineStart,
    );
    if (headingLine === undefined || headingLine.text !== headingMatch.line) {
      throw new Error("Chronology heading line could not be verified.");
    }
    const roleHeading: CandidateKnowledgeLexicalHit = {
      ...heading,
      text: headingLine.text,
      lineStart: headingLine.lineNumber,
      lineEnd: headingLine.lineNumber,
    };
    const group = chunksBySource.get(provenanceKey(heading.metadata.provenance)) ?? [];
    const headingIndex = group.findIndex(({ chunkId }) => chunkId === heading.chunkId);
    if (headingIndex < 0) throw new Error("Chronology heading source order could not be verified.");

    const roleScopeChunks = [exact];
    const followingChunks: CandidateKnowledgeLexicalChunkInput[] = [];
    for (const chunk of group.slice(headingIndex + 1)) {
      const nextHeading = parseLeadingMarkdownHeading(chunk.text);
      const nextHeadingLevel = nextHeading?.level;
      if (
        (nextHeading !== undefined && isDatedCandidateRoleHeading(nextHeading.line)) ||
        (nextHeadingLevel !== undefined && nextHeadingLevel <= headingLevel)
      )
        break;
      roleScopeChunks.push(chunk);
      followingChunks.push(chunk);
    }
    const independentSelection = selectCandidateIndependentProjectEvidence(
      roleHeading,
      roleScopeChunks,
      jobQuery,
      candidateInstructions,
      maximumCandidateKnowledgeRetrievalChunkTextLength,
    );
    if (independentSelection.foundRegion) {
      const headingBlock = createCandidateRoleContributionBlock(
        [headingLine],
        headingLine.lineNumber,
      );
      const blocks = independentSelection.blocks;
      for (const { title, block } of independentSelection.overflowBundles) {
        const provenance = heading.metadata.provenance;
        requestedProjectOverflowHits.push(
          createCandidateKnowledgeLexicalHit({
            chunkId: lexicalDigest([
              "candidate-knowledge-independent-project-overflow-v1",
              provenance.storeId,
              provenance.knowledgeBaseId,
              provenance.sourceId,
              provenance.versionId,
              heading.chunkId,
              heading.text,
              heading.lineStart,
              heading.lineEnd,
              title,
              block.lineStart,
              block.lineEnd,
              block.text,
              ...block.sourceRanges.flatMap((range) => [
                range.chunkId,
                range.startOffset,
                range.endOffset,
              ]),
            ]),
            ordinal: heading.ordinal,
            lineStart: block.lineStart,
            lineEnd: block.lineEnd,
            text: block.text,
            metadata: heading.metadata,
            bm25Rank: heading.bm25Rank,
          }),
        );
      }
      if (blocks.length === 0 && headingBlock.text === heading.text) return heading;
      const text = [headingBlock.text, ...blocks.map(({ text: blockText }) => blockText)].join(
        "\n\n",
      );
      if (text.length > maximumCandidateKnowledgeRetrievalChunkTextLength) {
        throw new Error("Independent project role record exceeded its bounded evidence size.");
      }
      const provenance = heading.metadata.provenance;
      return createCandidateKnowledgeLexicalHit({
        chunkId: lexicalDigest([
          "candidate-knowledge-independent-project-record-v1",
          provenance.storeId,
          provenance.knowledgeBaseId,
          provenance.sourceId,
          provenance.versionId,
          heading.chunkId,
          headingBlock.lineStart,
          headingBlock.lineEnd,
          headingBlock.text,
          ...headingBlock.sourceRanges.flatMap((range) => [
            range.chunkId,
            range.startOffset,
            range.endOffset,
          ]),
          ...blocks.flatMap((block) => [
            block.lineStart,
            block.lineEnd,
            block.text,
            ...block.sourceRanges.flatMap((range) => [
              range.chunkId,
              range.startOffset,
              range.endOffset,
            ]),
          ]),
        ]),
        ordinal: heading.ordinal,
        lineStart: headingBlock.lineStart,
        lineEnd: Math.max(headingBlock.lineEnd, ...blocks.map(({ lineEnd }) => lineEnd)),
        text,
        metadata: heading.metadata,
        bm25Rank: heading.bm25Rank,
      });
    }
    const contributionSelection = selectCandidateRoleContributionBlocks(
      roleHeading,
      roleScopeChunks,
      jobQuery,
      maximumCandidateKnowledgeRetrievalChunkTextLength,
    );
    if (contributionSelection.foundRegion) {
      const blocks = contributionSelection.blocks;
      const text = [headingLine.text, ...blocks.map(({ text: blockText }) => blockText)].join(
        "\n\n",
      );
      const provenance = heading.metadata.provenance;
      return createCandidateKnowledgeLexicalHit({
        chunkId: lexicalDigest([
          "candidate-knowledge-experience-role-contributions-v1",
          provenance.storeId,
          provenance.knowledgeBaseId,
          provenance.sourceId,
          provenance.versionId,
          heading.chunkId,
          ...blocks.flatMap((block) => [
            block.lineStart,
            block.lineEnd,
            block.text,
            ...block.sourceRanges.flatMap((range) => [
              range.chunkId,
              range.startOffset,
              range.endOffset,
            ]),
          ]),
        ]),
        ordinal: heading.ordinal,
        lineStart: headingLine.lineNumber,
        lineEnd: Math.max(headingLine.lineNumber, ...blocks.map(({ lineEnd }) => lineEnd)),
        text,
        metadata: heading.metadata,
        bm25Rank: heading.bm25Rank,
      });
    }

    const constituentIds: string[] = [heading.chunkId];
    const bodyTexts = [headingLine.text];
    let lineEnd = headingLine.lineNumber;
    for (const chunk of followingChunks) {
      const candidateText = `${bodyTexts.join("\n\n")}\n\n${chunk.text}`;
      if (candidateText.length > maximumCandidateKnowledgeRetrievalChunkTextLength) break;
      bodyTexts.push(chunk.text);
      constituentIds.push(chunk.chunkId);
      lineEnd = chunk.lineEnd;
    }
    if (constituentIds.length === 1 && heading.text === headingLine.text) return heading;

    const provenance = heading.metadata.provenance;
    return createCandidateKnowledgeLexicalHit({
      chunkId: lexicalDigest([
        "candidate-knowledge-experience-role-record-v1",
        provenance.storeId,
        provenance.knowledgeBaseId,
        provenance.sourceId,
        provenance.versionId,
        ...constituentIds,
      ]),
      ordinal: heading.ordinal,
      lineStart: headingLine.lineNumber,
      lineEnd,
      text: bodyTexts.join("\n\n"),
      metadata: heading.metadata,
      bm25Rank: heading.bm25Rank,
    });
  });

  const packedOverflowHits: CandidateKnowledgeLexicalHit[] = [];
  for (const hit of requestedProjectOverflowHits) {
    const previous = packedOverflowHits.at(-1);
    const text = previous === undefined ? hit.text : `${previous.text}\n\n${hit.text}`;
    if (
      previous !== undefined &&
      previous.ordinal === hit.ordinal &&
      provenanceKey(previous.metadata.provenance) === provenanceKey(hit.metadata.provenance) &&
      text.length <= maximumCandidateKnowledgeRetrievalChunkTextLength
    ) {
      packedOverflowHits[packedOverflowHits.length - 1] = createCandidateKnowledgeLexicalHit({
        ...previous,
        chunkId: lexicalDigest([
          "candidate-knowledge-independent-project-overflow-pack-v1",
          previous.chunkId,
          hit.chunkId,
        ]),
        lineStart: Math.min(previous.lineStart, hit.lineStart),
        lineEnd: Math.max(previous.lineEnd, hit.lineEnd),
        text,
      });
    } else packedOverflowHits.push(hit);
  }
  return Object.freeze({
    chronologyHits: Object.freeze(composedChronologyHits),
    requestedProjectOverflowHits: Object.freeze(packedOverflowHits),
  });
}

/** Replace selected dated headings with deterministic bounded source role records. */
export function combineCandidateExperienceBodyEvidence(
  chronologyHits: readonly CandidateKnowledgeLexicalHit[],
  sourceChunks: readonly CandidateKnowledgeLexicalChunkInput[],
  jobQuery = "",
  candidateInstructions = "",
): readonly CandidateKnowledgeLexicalHit[] {
  return composeCandidateExperienceBodyEvidence(
    chronologyHits,
    sourceChunks,
    jobQuery,
    candidateInstructions,
  ).chronologyHits;
}
