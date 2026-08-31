import type { ScoredEvidenceChunk } from "@draft-loop/domain";

const protectedValuePatterns = [
  /https?:\/\/[^\s)]+/giu,
  /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu,
  /(?<![\p{L}\p{N}])\d+(?:[.,]\d+)*(?:%|[kmb])?(?![\p{L}\p{N}])/giu,
  /\b[\p{Lu}]{2,}(?:[+-][\p{Lu}\p{N}]+)*\b/gu,
  /\b\p{Lu}[\p{L}'’-]+(?:\s+\p{Lu}[\p{L}'’-]+)+\b/gu,
  /\b(?:at|for)\s+(\p{Lu}[\p{L}'’-]+)\b/gu,
] as const;

export interface AuthorGroundingGuideEntry {
  readonly evidenceChunkId: string;
  readonly protectedValues: readonly string[];
}

interface ProtectedValueMatch {
  readonly value: string;
  readonly start: number;
  readonly patternIndex: number;
  readonly matchIndex: number;
}

function normalizedIdentity(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US");
}

/** Extract exact protected values in first-occurrence order without duplicates. */
export function extractProtectedValues(value: string): readonly string[] {
  const matches: ProtectedValueMatch[] = protectedValuePatterns.flatMap((pattern, patternIndex) =>
    [...value.matchAll(pattern)].map((match, matchIndex) => {
      const extracted = match[1] ?? match[0];
      const captureOffset = match[1] === undefined ? 0 : match[0].indexOf(match[1]);
      return {
        value: extracted,
        start: (match.index ?? 0) + Math.max(captureOffset, 0),
        patternIndex,
        matchIndex,
      };
    }),
  );
  matches.sort(
    (left, right) =>
      left.start - right.start ||
      left.patternIndex - right.patternIndex ||
      left.matchIndex - right.matchIndex,
  );

  const seen = new Set<string>();
  const extracted: string[] = [];
  for (const match of matches) {
    const identity = normalizedIdentity(match.value);
    if (seen.has(identity)) continue;
    seen.add(identity);
    extracted.push(match.value);
  }
  return Object.freeze(extracted);
}

/** Derive the content-minimal per-chunk protected-value allowlist for an author. */
export function createAuthorGroundingGuide(
  retrievedEvidence: readonly ScoredEvidenceChunk[],
): readonly AuthorGroundingGuideEntry[] {
  return Object.freeze(
    retrievedEvidence.flatMap((chunk) => {
      const protectedValues = extractProtectedValues(chunk.text);
      if (protectedValues.length === 0) return [];
      return [
        Object.freeze({
          evidenceChunkId: chunk.id,
          protectedValues,
        }),
      ];
    }),
  );
}
