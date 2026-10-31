import type { ScoredEvidenceChunk } from "@draft-loop/domain";

/** One retrieved chunk a call was sent, as the record keeps it: where it came from, never its text. */
export interface RetrievedEvidenceRef {
  readonly sourceId: string;
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly rank: number;
}

/**
 * The retrieved evidence a call was sent, as the optional member an execution record carries. A
 * run without retrieval records nothing, so a record without the member means "not retrieved",
 * not "nothing retrieved".
 */
export function retrievedEvidenceRefs(
  chunks: readonly ScoredEvidenceChunk[] | undefined,
): Readonly<{ retrievedEvidence?: readonly RetrievedEvidenceRef[] }> {
  if (chunks === undefined) return {};
  return {
    retrievedEvidence: chunks.map(({ sourceId, lineStart, lineEnd, rank }) => ({
      sourceId,
      lineStart,
      lineEnd,
      rank,
    })),
  };
}
