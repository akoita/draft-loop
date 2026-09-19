import type { ScoredEvidenceChunk } from "@draft-loop/domain";

const maximumEvidenceQueryTerms = 48;
const evidenceQueryStopWords = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "our",
  "that",
  "the",
  "their",
  "this",
  "to",
  "we",
  "will",
  "with",
  "you",
  "your",
]);

function normalizedTokens(value: string): readonly string[] {
  return (
    value
      .normalize("NFKC")
      .toLocaleLowerCase("en-US")
      .match(/[\p{L}\p{N}_-]+/gu) ?? []
  );
}

export function evidenceQueryTerms(query: string): readonly string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const token of normalizedTokens(query.trim())) {
    if (token.length < 2 || evidenceQueryStopWords.has(token) || seen.has(token)) continue;
    seen.add(token);
    terms.push(token);
    if (terms.length === maximumEvidenceQueryTerms) break;
  }
  return terms;
}

/** Prefer precise multi-term hits only when doing so preserves at least one result. */
export function preferMultiTermEvidenceHits<Hit extends Pick<ScoredEvidenceChunk, "text">>(
  queryTerms: readonly string[],
  hits: readonly Hit[],
): readonly Hit[] {
  if (queryTerms.length < 2 || hits.length < 2) return hits;
  const normalizedQueryTerms = new Set(queryTerms.map((term) => term.toLocaleLowerCase("en-US")));
  const multiTermHits = hits.filter((hit) => {
    const hitTerms = new Set(normalizedTokens(hit.text));
    let matches = 0;
    for (const term of normalizedQueryTerms) {
      if (hitTerms.has(term)) matches += 1;
      if (matches === 2) return true;
    }
    return false;
  });
  return multiTermHits.length === 0 ? hits : multiTermHits;
}
