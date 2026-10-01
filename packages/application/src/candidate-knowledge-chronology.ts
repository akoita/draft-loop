import type {
  CandidateKnowledgeLexicalChunkInput,
  CandidateKnowledgeLexicalHit,
  CandidateKnowledgeRetrievalStatus,
  ScoredEvidenceChunk,
} from "@draft-loop/domain";
import { parseLeadingMarkdownHeading } from "./candidate-knowledge-heading.js";

export const candidateKnowledgeChronologyQueryLimit = 100;
export const candidateKnowledgeChronologyProviderByteLimit = 131_072;
export const candidateKnowledgeChronologyLocalSourceByteLimit = 512 * 1024;

const monthAndOpenRangeTerms = [
  "jan",
  "january",
  "feb",
  "february",
  "mar",
  "march",
  "apr",
  "april",
  "may",
  "jun",
  "june",
  "jul",
  "july",
  "aug",
  "august",
  "sep",
  "sept",
  "september",
  "oct",
  "october",
  "nov",
  "november",
  "dec",
  "december",
  "present",
  "current",
  "now",
] as const;

function yearBatchQueries(): readonly string[] {
  const queries: string[] = [];
  for (let firstYear = 1900; firstYear <= 2099; firstYear += 40) {
    queries.push(Array.from({ length: 40 }, (_, offset) => String(firstYear + offset)).join(" "));
  }
  return queries;
}

/** Fixed lexical probes for date headings, below the CKB query-term and text limits. */
export const candidateKnowledgeChronologyQueries: readonly string[] = Object.freeze([
  monthAndOpenRangeTerms.join(" "),
  ...yearBatchQueries(),
]);

const datedMarkdownHeadingPattern =
  /^\s*#{1,6}\s+[^\n]*(?:19|20)\d{2}[^\n]*(?:\bto\b|[–—-])[^\n]*(?:(?:19|20)\d{2}|present|current|now)\b/iu;

export interface CandidateKnowledgeChronologyQueryResult {
  readonly status: CandidateKnowledgeRetrievalStatus;
  readonly hits: readonly CandidateKnowledgeLexicalHit[];
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

interface ChronologyCandidate {
  readonly chunkId: string;
  readonly ordinal: number;
  readonly text: string;
  readonly metadata: {
    readonly provenance: {
      readonly storeId: string;
      readonly knowledgeBaseId: string;
      readonly sourceId: string;
      readonly versionId: string;
    };
  };
}

function compareChronologyCandidates(
  left: ChronologyCandidate,
  right: ChronologyCandidate,
): number {
  const leftProvenance = left.metadata.provenance;
  const rightProvenance = right.metadata.provenance;
  for (const [leftValue, rightValue] of [
    [leftProvenance.storeId, rightProvenance.storeId],
    [leftProvenance.knowledgeBaseId, rightProvenance.knowledgeBaseId],
    [leftProvenance.sourceId, rightProvenance.sourceId],
    [leftProvenance.versionId, rightProvenance.versionId],
  ] as const) {
    const comparison = compareStrings(leftValue, rightValue);
    if (comparison !== 0) return comparison;
  }
  return left.ordinal - right.ordinal || compareStrings(left.chunkId, right.chunkId);
}

function selectDatedChronologyCandidates<T extends ChronologyCandidate>(
  candidates: readonly T[],
  providerLimit: number,
): readonly T[] {
  const dated = candidates.filter((candidate) => {
    const heading = parseLeadingMarkdownHeading(candidate.text);
    return heading !== undefined && datedMarkdownHeadingPattern.test(heading.line);
  });
  dated.sort(compareChronologyCandidates);
  const seenIds = new Set<string>();
  const selected = dated.filter((candidate) => {
    if (seenIds.has(candidate.chunkId)) return false;
    seenIds.add(candidate.chunkId);
    return true;
  });
  if (selected.length > providerLimit) {
    throw new Error("Chronology heading count exceeds the provider retrieval limit.");
  }
  return Object.freeze(selected);
}

/**
 * Select dated Markdown headings from matched chronology probes in stable
 * source order. A saturated matched query cannot establish a complete bounded
 * set, and too many headings cannot be silently truncated for provider input.
 */
export function selectCandidateKnowledgeChronologyHits(
  results: readonly CandidateKnowledgeChronologyQueryResult[],
  providerLimit: number,
): readonly CandidateKnowledgeLexicalHit[] {
  if (!Number.isSafeInteger(providerLimit) || providerLimit < 1) {
    throw new Error("Chronology evidence exceeds provider bounds.");
  }

  const candidates: CandidateKnowledgeLexicalHit[] = [];
  for (const result of results) {
    if (result.status !== "matched") continue;
    if (result.hits.length >= candidateKnowledgeChronologyQueryLimit) {
      throw new Error("Chronology query saturated its retrieval limit.");
    }
    candidates.push(...result.hits);
  }

  return selectDatedChronologyCandidates(candidates, providerLimit);
}

/** Select the complete dated-heading set from verified chunks of pinned sources. */
export function selectCandidateKnowledgeChronologySourceChunks(
  sourceChunks: readonly CandidateKnowledgeLexicalChunkInput[],
  providerLimit: number,
): readonly CandidateKnowledgeLexicalChunkInput[] {
  if (!Number.isSafeInteger(providerLimit) || providerLimit < 1) {
    throw new Error("Chronology evidence exceeds provider bounds.");
  }
  return selectDatedChronologyCandidates(sourceChunks, providerLimit);
}

/** Fail closed when merged provider evidence exceeds its item or byte bounds. */
export function assertCandidateKnowledgeProviderBounds(
  hits: readonly ScoredEvidenceChunk[],
  providerLimit: number,
): void {
  if (
    hits.length > providerLimit ||
    Buffer.byteLength(JSON.stringify(hits), "utf8") > candidateKnowledgeChronologyProviderByteLimit
  ) {
    throw new Error("Chronology evidence exceeds provider bounds.");
  }
}

/** Match the Experience gate without treating embedded or punctuated aliases as exact. */
export function requiresExperienceChronology(requiredSections: readonly string[]): boolean {
  return requiredSections.some(
    (section) =>
      section.normalize("NFKC").replace(/\s+/gu, "").toLocaleLowerCase("en-US") === "experience",
  );
}
