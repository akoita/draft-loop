import type { ScoredEvidenceChunk } from "@draft-loop/domain";
import type { AuthorArtifactProposal } from "@draft-loop/schemas";

import { extractProtectedValues, supportsProtectedValueInChunks } from "./author-grounding.js";
import { tokens, uncoveredBlockTokens } from "./claim-coverage.js";
import { unsupportedSingleWordNames } from "./single-word-name-grounding.js";

type ProposalSection = AuthorArtifactProposal["sections"][number];
type ProposalBlock = ProposalSection["blocks"][number];

/**
 * Closed set of English function words that uncovered text may use without
 * evidence: articles, prepositions, conjunctions, pronouns, auxiliaries, and
 * joining connectives. Verbs, nouns, and numbers are never listed here.
 */
const functionWords = new Set([
  // Articles.
  "a",
  "an",
  "the",
  // Prepositions.
  "across",
  "as",
  "at",
  "by",
  "for",
  "from",
  "in",
  "into",
  "of",
  "on",
  "to",
  "with",
  "within",
  // Conjunctions.
  "and",
  "but",
  "or",
  // Pronouns.
  "i",
  "it",
  "its",
  "my",
  "their",
  "this",
  "these",
  "those",
  "that",
  "which",
  "who",
  "where",
  // Auxiliaries.
  "be",
  "been",
  "has",
  "have",
  "is",
  "was",
  // Connectives.
  "including",
  "while",
]);

const monthPattern =
  "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
const yearPattern = "((?:19|20)\\d{2})";
const dateRangePattern = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:${monthPattern}\\s+)?${yearPattern}(?:\\s*[-–—]\\s*|\\s+to\\s+)(?:(?:${monthPattern}\\s+)?${yearPattern}|(present|current|now))(?![\\p{L}\\p{N}])`,
  "giu",
);

interface DateRange {
  readonly startMonth: string | undefined;
  readonly startYear: string;
  readonly endMonth: string | undefined;
  /** An end year, or undefined for an open range ending in present, current, or now. */
  readonly endYear: string | undefined;
}

function monthKey(month: string | undefined): string | undefined {
  return month?.toLocaleLowerCase("en-US").slice(0, 3);
}

function dateRanges(text: string): readonly DateRange[] {
  return [...text.matchAll(dateRangePattern)].flatMap((match) => {
    const [, startMonth, startYear, endMonth, endYear] = match;
    if (startYear === undefined) return [];
    return [
      {
        startMonth: monthKey(startMonth),
        startYear,
        endMonth: monthKey(endMonth),
        endYear,
      },
    ];
  });
}

function rangeSupports(evidence: DateRange, stated: DateRange): boolean {
  return (
    evidence.startYear === stated.startYear &&
    (stated.startMonth === undefined || evidence.startMonth === stated.startMonth) &&
    evidence.endYear === stated.endYear &&
    (stated.endMonth === undefined || evidence.endMonth === stated.endMonth)
  );
}

/**
 * Return true when a date range in the text is not stated as a range in one
 * evidence chunk. Ranges run from an optional month and a year, through a
 * dash or "to", to an optional month and a year or to present, current, or
 * now. Years and open ends must match exactly; a month stated in the text must
 * match, while a month only in the evidence is allowed. Separate years in
 * different chunks cannot support one range.
 */
export function hasUnsupportedDateRange(text: string, evidenceChunks: readonly string[]): boolean {
  const evidenceRanges = evidenceChunks.map(dateRanges);
  return dateRanges(text).some(
    (stated) =>
      !evidenceRanges.some((ranges) => ranges.some((evidence) => rangeSupports(evidence, stated))),
  );
}

/**
 * Return true when block text outside substantive claims introduces a fact
 * the evidence does not support.
 *
 * Uncovered text escapes the claim-level checks, so it is grounded four ways:
 * every uncovered content word must appear as a whole token in some retrieved
 * chunk; every protected value in the block must be supported by the chunks
 * its substantive claims cite; every date range must appear as the same range
 * in one cited chunk; and every capitalised single-word name must appear in
 * some retrieved chunk. Wording made only of function words and evidence words
 * is left to critic and human review.
 */
export function uncoveredTextIntroducesUnsupportedFact(
  section: Pick<ProposalSection, "title" | "kind">,
  block: ProposalBlock,
  retrievedEvidence: readonly ScoredEvidenceChunk[],
): boolean {
  const allChunks = retrievedEvidence.map((chunk) => chunk.text);
  const evidenceTokens = new Set(allChunks.flatMap((text) => tokens(text)));
  const ungroundedWord = uncoveredBlockTokens(section, block).some(
    (token) => !functionWords.has(token) && !evidenceTokens.has(token),
  );
  if (ungroundedWord) return true;

  const citedIds = new Set(
    block.claims.filter((claim) => claim.substantive).flatMap((claim) => claim.evidenceChunkIds),
  );
  const citedChunks = retrievedEvidence
    .filter((chunk) => citedIds.has(chunk.id))
    .map((chunk) => chunk.text);
  return (
    extractProtectedValues(block.text).some(
      (value) => !supportsProtectedValueInChunks(citedChunks, value),
    ) ||
    hasUnsupportedDateRange(block.text, citedChunks) ||
    unsupportedSingleWordNames(block.text, allChunks).length > 0
  );
}
