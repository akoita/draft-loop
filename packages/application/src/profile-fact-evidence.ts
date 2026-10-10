import { createHash } from "node:crypto";

import type {
  CandidateKnowledgeLexicalChunkInput,
  CandidateKnowledgeRetrievalSourceVersionReference,
  CandidateKnowledgeRetrievalSourceVersionReferenceInput,
  CanonicalCandidateProfile,
  CanonicalCandidateProfileFactProvenanceReference,
  ScoredEvidenceChunk,
} from "@draft-loop/domain";
import {
  applySemanticRelevanceFloor,
  type SemanticRelevanceFloor,
  semanticRelevanceFloorForIdentity,
  type TextEmbedder,
} from "@draft-loop/embeddings";
import { evidenceQueryTerms } from "@draft-loop/storage/evidence-retrieval-precision";

import {
  candidateKnowledgeEvidenceChecksum,
  candidateKnowledgeEvidenceSourceId,
} from "./candidate-knowledge-retrieval.js";
import { normalizePlainEvidenceText } from "./evidence-text-normalization.js";
import type { SemanticRetrievalMode } from "./semantic-candidate-knowledge-retrieval.js";
import type { RetrievalMode } from "./workspace-retrieval-mode.js";

/**
 * Run evidence drawn from a reviewed canonical profile. Each fact with a grounded quote becomes one
 * item shaped like a retrieved chunk, so author citations accept it without a special case: its
 * source id and checksum are those of the cited source version, its line range is where the quote
 * sits in that version, and its text is the fact value plus the exact quote. Facts are ranked
 * against the run query, and up to a fixed share of the retrieval limit is added beside the chunks.
 */

export const profileFactEvidenceIdPrefix = "profile-fact-";

/** Facts add at most two fifths of the retrieval limit (8 beside 20 chunks). */
export function profileFactEvidenceSlots(limit: number): number {
  return Math.max(0, Math.floor((limit * 2) / 5));
}

/** One fact item with the fact and exact provenance it came from. */
export interface ProfileFactEvidenceCandidate {
  readonly item: ScoredEvidenceChunk;
  readonly factId: string;
  readonly provenance: CanonicalCandidateProfileFactProvenanceReference & {
    readonly quote: string;
  };
}

export interface ProfileFactEvidenceCandidatesRequest {
  readonly profile: Pick<CanonicalCandidateProfile, "id" | "version" | "facts">;
  readonly workspaceId: string;
  /** Hashed source ids of the run's evidence manifest; a fact citing anything else is left out. */
  readonly manifestSourceIds: ReadonlySet<string>;
  /**
   * Loads the eligible chunks of exact pinned source versions. Chunks the caller withholds are
   * simply absent, so a quote inside a withheld section is not found and its fact is left out.
   */
  readonly loadSourceChunks: (
    references: readonly CandidateKnowledgeRetrievalSourceVersionReference[],
  ) => Promise<readonly CandidateKnowledgeLexicalChunkInput[]>;
}

function referenceKey(reference: CandidateKnowledgeRetrievalSourceVersionReferenceInput): string {
  return JSON.stringify([
    reference.storeId,
    reference.knowledgeBaseId,
    reference.sourceId,
    reference.versionId,
  ]);
}

function sourceVersionReference(
  reference: CandidateKnowledgeRetrievalSourceVersionReference,
): CandidateKnowledgeRetrievalSourceVersionReference {
  return {
    storeId: reference.storeId,
    knowledgeBaseId: reference.knowledgeBaseId,
    sourceId: reference.sourceId,
    versionId: reference.versionId,
  };
}

interface LocatedSource {
  readonly text: string;
  /** Character offset at which each line (index 0 is line 1) starts. */
  readonly lineOffsets: readonly number[];
  /** Ordinal of the first chunk on each line, when one covers it. */
  readonly lineOrdinals: readonly (number | undefined)[];
}

/**
 * Rebuild a source version's text from its chunks. Chunks never overlap and carry their exact lines
 * (an overlong line is split into consecutive pieces on the same line), so lines no chunk covers
 * (blank or withheld) become empty and a quote spanning them is not found.
 */
function locatedSource(chunks: readonly CandidateKnowledgeLexicalChunkInput[]): LocatedSource {
  const ordered = [...chunks].sort((left, right) => left.ordinal - right.ordinal);
  const lines: string[] = [];
  const lineOrdinals: (number | undefined)[] = [];
  for (const chunk of ordered) {
    const chunkLines = chunk.text.split("\n");
    const splitLine = chunk.lineStart === chunk.lineEnd && chunkLines.length === 1;
    for (const [index, line] of chunkLines.entries()) {
      const lineIndex = chunk.lineStart - 1 + index;
      while (lines.length <= lineIndex) {
        lines.push("");
        lineOrdinals.push(undefined);
      }
      lines[lineIndex] = splitLine ? `${lines[lineIndex]}${line}` : line;
      lineOrdinals[lineIndex] ??= chunk.ordinal;
    }
  }
  const lineOffsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineOffsets.push(offset);
    offset += line.length + 1;
  }
  return { text: lines.join("\n"), lineOffsets, lineOrdinals };
}

function lineIndexAt(lineOffsets: readonly number[], offset: number): number {
  let low = 0;
  let high = lineOffsets.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if ((lineOffsets[middle] ?? 0) <= offset) low = middle;
    else high = middle - 1;
  }
  return low;
}

function factEvidenceId(
  profile: ProfileFactEvidenceCandidatesRequest["profile"],
  factId: string,
  reference: CandidateKnowledgeRetrievalSourceVersionReference,
): string {
  return `${profileFactEvidenceIdPrefix}${createHash("sha256")
    .update(JSON.stringify([profile.id, profile.version, factId, referenceKey(reference)]), "utf8")
    .digest("hex")
    .slice(0, 32)}`;
}

/** The fact value, then the exact quote unless it says nothing more than the value. */
function factEvidenceText(value: string, quote: string): string {
  return normalizePlainEvidenceText(value) === normalizePlainEvidenceText(quote)
    ? quote
    : `${value}\n${quote}`;
}

/**
 * Turn a reviewed profile's facts into run evidence items, in profile order. A fact uses its first
 * provenance reference that has a quote, cites a source version in the evidence manifest, and whose
 * quote occurs verbatim in that version; a fact with no such reference is left out.
 */
export async function profileFactEvidenceCandidates(
  request: ProfileFactEvidenceCandidatesRequest,
): Promise<readonly ProfileFactEvidenceCandidate[]> {
  const eligible = (reference: CanonicalCandidateProfileFactProvenanceReference) =>
    reference.quote !== undefined &&
    reference.quote.length > 0 &&
    request.manifestSourceIds.has(candidateKnowledgeEvidenceSourceId(reference));
  const references = new Map<string, CandidateKnowledgeRetrievalSourceVersionReference>();
  for (const fact of request.profile.facts) {
    for (const reference of fact.provenance) {
      if (eligible(reference)) {
        references.set(referenceKey(reference), sourceVersionReference(reference));
      }
    }
  }
  if (references.size === 0) return [];

  const chunksBySource = new Map<string, CandidateKnowledgeLexicalChunkInput[]>();
  for (const chunk of await request.loadSourceChunks([...references.values()])) {
    const key = referenceKey(chunk.metadata.provenance);
    if (!references.has(key)) continue;
    const group = chunksBySource.get(key);
    if (group === undefined) chunksBySource.set(key, [chunk]);
    else group.push(chunk);
  }
  const sources = new Map<string, LocatedSource>();
  const sourceFor = (key: string): LocatedSource | undefined => {
    const existing = sources.get(key);
    if (existing !== undefined) return existing;
    const chunks = chunksBySource.get(key);
    if (chunks === undefined) return undefined;
    const located = locatedSource(chunks);
    sources.set(key, located);
    return located;
  };

  const candidates: ProfileFactEvidenceCandidate[] = [];
  for (const fact of request.profile.facts) {
    for (const reference of fact.provenance) {
      const quote = reference.quote;
      if (quote === undefined || !eligible(reference)) continue;
      const source = sourceFor(referenceKey(reference));
      const start = source?.text.indexOf(quote) ?? -1;
      if (source === undefined || start < 0) continue;
      const startLine = lineIndexAt(source.lineOffsets, start);
      const endLine = lineIndexAt(source.lineOffsets, start + quote.length - 1);
      const version = sourceVersionReference(reference);
      candidates.push({
        item: {
          id: factEvidenceId(request.profile, fact.id, version),
          workspaceId: request.workspaceId,
          sourceId: candidateKnowledgeEvidenceSourceId(version),
          ordinal: source.lineOrdinals[startLine] ?? 0,
          lineStart: startLine + 1,
          lineEnd: endLine + 1,
          checksum: candidateKnowledgeEvidenceChecksum(version),
          text: factEvidenceText(fact.value, quote),
          rank: 0,
        },
        factId: fact.id,
        provenance: { ...reference, quote },
      });
      break;
    }
  }
  return candidates;
}

export interface ProfileFactSemanticRanking {
  readonly mode: SemanticRetrievalMode;
  readonly embedder: TextEmbedder;
  /** Overrides the model's calibrated relevance floor; injectable for tests. */
  readonly relevanceFloor?: SemanticRelevanceFloor;
}

export interface RankProfileFactEvidenceRequest {
  readonly candidates: readonly ProfileFactEvidenceCandidate[];
  readonly query: string;
  readonly limit: number;
  /** The run's effective semantic mode and embedder; absent means lexical ranking. */
  readonly semantic?: ProfileFactSemanticRanking;
}

export interface RankedProfileFactEvidence {
  /** Best first; each item's rank is lower for a better match, as chunk ranks are. */
  readonly candidates: readonly ProfileFactEvidenceCandidate[];
  readonly effectiveMode: RetrievalMode;
}

const bm25K1 = 1.2;
const bm25B = 0.75;
const reciprocalRankFusionK = 60;

function tokens(value: string): readonly string[] {
  return (
    value
      .normalize("NFKC")
      .toLocaleLowerCase("en-US")
      .match(/[\p{L}\p{N}_-]+/gu) ?? []
  );
}

/** Okapi BM25 over the candidates' texts; only candidates sharing a query term are returned. */
function lexicalScores(
  candidates: readonly ProfileFactEvidenceCandidate[],
  terms: readonly string[],
): readonly { readonly index: number; readonly score: number }[] {
  const documents = candidates.map(({ item }) => tokens(item.text));
  const averageLength =
    documents.reduce((total, document) => total + document.length, 0) /
    Math.max(1, documents.length);
  const documentFrequency = new Map<string, number>();
  for (const document of documents) {
    for (const term of new Set(document)) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }
  const scored: { index: number; score: number }[] = [];
  for (const [index, document] of documents.entries()) {
    let score = 0;
    for (const term of terms) {
      const frequency = document.filter((token) => token === term).length;
      if (frequency === 0) continue;
      const containing = documentFrequency.get(term) ?? 0;
      const idf = Math.log(1 + (documents.length - containing + 0.5) / (containing + 0.5));
      score +=
        (idf * frequency * (bm25K1 + 1)) /
        (frequency + bm25K1 * (1 - bm25B + (bm25B * document.length) / (averageLength || 1)));
    }
    if (score > 0) scored.push({ index, score });
  }
  return scored.sort((left, right) => right.score - left.score || left.index - right.index);
}

function cosine(left: Float32Array, right: Float32Array): number {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  const norm = Math.sqrt(leftNorm) * Math.sqrt(rightNorm);
  return norm === 0 ? 0 : Math.max(-1, Math.min(1, dot / norm));
}

async function vectorScores(
  candidates: readonly ProfileFactEvidenceCandidate[],
  query: string,
  semantic: ProfileFactSemanticRanking,
): Promise<readonly { readonly index: number; readonly score: number }[] | undefined> {
  try {
    const [queryVector] = await semantic.embedder.embed([query], "query");
    const vectors = await semantic.embedder.embed(
      candidates.map(({ item }) => item.text),
      "document",
    );
    if (queryVector === undefined || vectors.length !== candidates.length) return undefined;
    const scored = vectors
      .map((vector, index) => ({ index, score: cosine(queryVector, vector) }))
      .sort((left, right) => right.score - left.score || left.index - right.index);
    const floor =
      semantic.relevanceFloor ?? semanticRelevanceFloorForIdentity(semantic.embedder.identity);
    return floor === undefined ? scored : applySemanticRelevanceFloor(scored, floor);
  } catch {
    return undefined;
  }
}

function ranked(
  candidates: readonly ProfileFactEvidenceCandidate[],
  order: readonly { readonly index: number; readonly score: number }[],
  limit: number,
): readonly ProfileFactEvidenceCandidate[] {
  return order.slice(0, limit).flatMap(({ index, score }) => {
    const candidate = candidates[index];
    return candidate === undefined
      ? []
      : [{ ...candidate, item: { ...candidate.item, rank: -score } }];
  });
}

/**
 * Rank fact candidates against the run query, under the same rules as the primary chunk query:
 * lexical BM25 by default; semantic or hybrid (reciprocal-rank fusion of vector and BM25 ranks)
 * when the run's semantic mode is in effect. A query without searchable terms selects no facts.
 * Semantic ranking falls back to the lexical result when embedding fails or the relevance floor
 * rejects every fact.
 */
export async function rankProfileFactEvidence(
  request: RankProfileFactEvidenceRequest,
): Promise<RankedProfileFactEvidence> {
  const { candidates, semantic } = request;
  const limit = Math.max(0, Math.floor(request.limit));
  const terms = evidenceQueryTerms(request.query);
  const lexical = lexicalScores(candidates, terms);
  const lexicalResult: RankedProfileFactEvidence = {
    candidates: ranked(candidates, lexical, limit),
    effectiveMode: "lexical",
  };
  if (semantic === undefined || terms.length === 0 || candidates.length === 0 || limit === 0) {
    return lexicalResult;
  }
  const vectors = await vectorScores(candidates, request.query, semantic);
  if (vectors === undefined || vectors.length === 0) return lexicalResult;
  if (semantic.mode === "semantic") {
    return { candidates: ranked(candidates, vectors, limit), effectiveMode: "semantic" };
  }
  const fused = new Map<number, number>();
  for (const order of [vectors, lexical]) {
    for (const [position, { index }] of order.entries()) {
      fused.set(index, (fused.get(index) ?? 0) + 1 / (reciprocalRankFusionK + position + 1));
    }
  }
  const order = [...fused.entries()]
    .map(([index, score]) => ({ index, score }))
    .sort((left, right) => right.score - left.score || left.index - right.index);
  return { candidates: ranked(candidates, order, limit), effectiveMode: "hybrid" };
}

export interface MergeProfileFactEvidenceRequest {
  /** Ranked fact items, best first. */
  readonly facts: readonly ProfileFactEvidenceCandidate[];
  /** Retrieved chunks in their selection order, reserved slots included. */
  readonly chunks: readonly ScoredEvidenceChunk[];
  readonly limit: number;
  /** Reserved chunks (contact, chronology, priority) are always kept and never deduplicated. */
  readonly isReserved?: (chunk: ScoredEvidenceChunk) => boolean;
}

/**
 * Facts first, up to their share of the limit and never crowding out a reserved chunk; then chunks
 * in order. A non-reserved chunk that contains a selected fact's quote from the same source version
 * is skipped as duplicate coverage.
 */
export function mergeProfileFactEvidence(
  request: MergeProfileFactEvidenceRequest,
): readonly ScoredEvidenceChunk[] {
  const limit = Math.max(0, Math.floor(request.limit));
  const isReserved = request.isReserved ?? (() => false);
  const reservedCount = request.chunks.filter(isReserved).length;
  const facts = request.facts.slice(
    0,
    Math.max(0, Math.min(profileFactEvidenceSlots(limit), limit - reservedCount)),
  );
  const duplicates = (chunk: ScoredEvidenceChunk) =>
    facts.some(
      ({ item, provenance }) =>
        item.sourceId === chunk.sourceId && chunk.text.includes(provenance.quote),
    );
  const selected: ScoredEvidenceChunk[] = facts.map(({ item }) => item);
  const selectedIds = new Set(selected.map(({ id }) => id));
  let remaining = limit - selected.length - reservedCount;
  for (const chunk of request.chunks) {
    if (selectedIds.has(chunk.id)) continue;
    if (isReserved(chunk)) {
      selected.push(chunk);
    } else if (remaining > 0 && !duplicates(chunk)) {
      selected.push(chunk);
      remaining -= 1;
    } else {
      continue;
    }
    selectedIds.add(chunk.id);
  }
  return Object.freeze(selected.slice(0, limit));
}
