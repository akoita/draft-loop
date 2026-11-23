/*
 * The candidate's name as citable evidence (#3296). A profile usually states the name as its top
 * heading (`# Amara Okafor`, `# Candidate profile: Nila Ardent`), apart from the contact record.
 * Retrieval reserves the contact record, so it also reserves that heading from the same source:
 * otherwise the author never sees the name and writes `[Your name]`. A heading that names no
 * person (`# Curriculum vitae`) is never reserved.
 */
import type {
  CandidateKnowledgeLexicalChunkInput,
  CandidateKnowledgeLexicalHit,
} from "@draft-loop/domain";
import { createCandidateKnowledgeLexicalHit } from "@draft-loop/domain";

import {
  isLeadingMarkdownHeadingOnly,
  parseLeadingMarkdownHeading,
} from "./candidate-knowledge-heading.js";

const documentLabelPrefixPattern =
  /^(?:candidate(?:\s+profile)?|profile|cv|curriculum\s+vitae|r[ée]sum[ée]|resume)\s*(?::|[-–—|])\s*/iu;
const nameWordPattern = /^\p{Lu}[\p{L}'’.-]*$/u;
const documentWords = new Set([
  "about",
  "background",
  "candidate",
  "career",
  "contact",
  "curriculum",
  "cv",
  "details",
  "education",
  "experience",
  "history",
  "information",
  "overview",
  "personal",
  "portfolio",
  "profile",
  "record",
  "resume",
  "résumé",
  "skills",
  "summary",
  "vitae",
]);

/** The person a top-level heading names, or undefined when it names a document instead. */
export function candidateNameFromHeading(text: string): string | undefined {
  if (!isLeadingMarkdownHeadingOnly(text)) return undefined;
  const heading = parseLeadingMarkdownHeading(text);
  if (heading === undefined || heading.level !== 1) return undefined;
  const title = heading.line
    .replace(/^\s{0,3}#\s+/u, "")
    .replace(/\s*#*\s*$/u, "")
    .replace(/\*\*|__/gu, "")
    .trim()
    .replace(documentLabelPrefixPattern, "")
    .trim();
  const words = title.split(/\s+/u);
  if (words.length < 2 || words.length > 4) return undefined;
  const namesPerson = words.every(
    (word) => nameWordPattern.test(word) && !documentWords.has(word.toLowerCase()),
  );
  return namesPerson ? title : undefined;
}

/**
 * The top heading of the contact record's source when it names the candidate, as an unchanged
 * lexical hit. Only the source's first heading counts, and only when no other chunk precedes it.
 */
export function selectCandidateNameEvidence(
  contactHit: CandidateKnowledgeLexicalHit | undefined,
  sourceChunks: readonly CandidateKnowledgeLexicalChunkInput[],
): CandidateKnowledgeLexicalHit | undefined {
  if (contactHit === undefined) return undefined;
  const provenance = JSON.stringify(contactHit.metadata.provenance);
  const first = sourceChunks
    .filter((chunk) => JSON.stringify(chunk.metadata.provenance) === provenance)
    .reduce<CandidateKnowledgeLexicalChunkInput | undefined>(
      (earliest, chunk) =>
        earliest === undefined || chunk.ordinal < earliest.ordinal ? chunk : earliest,
      undefined,
    );
  if (
    first === undefined ||
    first.chunkId === contactHit.chunkId ||
    candidateNameFromHeading(first.text) === undefined
  ) {
    return undefined;
  }
  return createCandidateKnowledgeLexicalHit({ ...first, bm25Rank: 0 });
}
