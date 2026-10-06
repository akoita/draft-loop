import type { CanonicalCandidateProfileProvenanceReference } from "@draft-loop/schemas";

/** Comparison form for profile text: Unicode-normalized, trimmed, whitespace-collapsed, lower-cased. */
export function normalizedSemantic(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

export function referenceKey(reference: CanonicalCandidateProfileProvenanceReference): string {
  return JSON.stringify([
    reference.storeId,
    reference.knowledgeBaseId,
    reference.sourceId,
    reference.versionId,
    reference.kind,
  ]);
}

export function lexicalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function uniqueSorted<T>(values: readonly T[], key: (value: T) => string): readonly T[] {
  const entries = new Map<string, T>();
  for (const value of values) entries.set(key(value), value);
  return [...entries.entries()]
    .sort(([left], [right]) => lexicalCompare(left, right))
    .map(([, value]) => value);
}
