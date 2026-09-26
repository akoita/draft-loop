import type {
  CandidateKnowledgeLexicalHit,
  CandidateKnowledgeRetrievalStatus,
} from "@draft-loop/domain";

export const candidatePriorityEvidenceQueryLimit = 20;
export const candidatePriorityEvidenceTextLimit = 2_000;
export const candidatePriorityEvidenceChunkLimit = 3;

export interface CandidatePriorityEvidenceQueryResult {
  readonly status: CandidateKnowledgeRetrievalStatus;
  readonly hits: readonly CandidateKnowledgeLexicalHit[];
}

const singleLineMarkdownHeadingPattern = /^\s*#{1,6}\s+[^\r\n]*(?:\r?\n)?\s*$/u;

/**
 * Return the first explicit Prioritize sentence for one local CKB query, or the
 * trimmed instructions when no such sentence is present. Both forms are bounded.
 */
export function candidatePriorityEvidenceQuery(
  instructions: string | undefined,
): string | undefined {
  if (instructions === undefined) return undefined;
  const trimmed = instructions.trim();
  if (trimmed.length === 0) return undefined;

  const boundaries = /\r\n|[\r\n]|[.!?](?=\s|$)/gu;
  let sentenceStart = 0;
  for (const boundary of trimmed.matchAll(boundaries)) {
    const index = boundary.index;
    if (index === undefined) continue;
    const punctuation = /^[.!?]$/u.test(boundary[0]);
    const sentenceEnd = index + (punctuation ? 1 : 0);
    const sentence = trimmed.slice(sentenceStart, sentenceEnd).trim();
    if (/^Prioritize\b/iu.test(sentence)) {
      return sentence.slice(0, candidatePriorityEvidenceTextLimit);
    }
    sentenceStart = index + boundary[0].length;
  }

  const finalSentence = trimmed.slice(sentenceStart).trim();
  if (/^Prioritize\b/iu.test(finalSentence)) {
    return finalSentence.slice(0, candidatePriorityEvidenceTextLimit);
  }
  return trimmed.slice(0, candidatePriorityEvidenceTextLimit);
}

/** Select a small ordered set of matched body chunks, never heading-only hits. */
export function selectCandidatePriorityEvidence(
  result: CandidatePriorityEvidenceQueryResult,
  providerLimit: number,
): readonly CandidateKnowledgeLexicalHit[] {
  if (result.status !== "matched") return [];

  const maximum = Math.max(0, Math.min(candidatePriorityEvidenceChunkLimit, providerLimit));
  if (maximum === 0) return [];
  const selected: CandidateKnowledgeLexicalHit[] = [];
  const seenIds = new Set<string>();
  for (const hit of result.hits) {
    if (singleLineMarkdownHeadingPattern.test(hit.text) || seenIds.has(hit.chunkId)) continue;
    seenIds.add(hit.chunkId);
    selected.push(hit);
    if (selected.length >= maximum) break;
  }
  return Object.freeze(selected);
}
