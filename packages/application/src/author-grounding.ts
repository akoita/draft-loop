import type { ScoredEvidenceChunk } from "@draft-loop/domain";
import {
  protectedSoftwareDescriptionParts,
  softwareObjectAppositivePattern,
} from "./author-software-description-parts.js";
import {
  experienceClaimValues,
  sourceExperienceValues,
  supportsExperienceClaim,
} from "./experience-grounding.js";
import { supportsInlineStrongMultiwordName } from "./inline-strong-name-grounding.js";
import { narrowOpeningActionVerbs, withoutOpeningActionVerb } from "./opening-action-verbs.js";
import { supportsProtectedValueParaphrase } from "./protected-value-equivalence.js";

const protectedNumberPattern = /(?<![\p{L}\p{N}])\d+(?:[.,]\d+)*(?:%|[kmb])?(?![\p{L}\p{N}])/giu;

// Mixed-case names must also appear in source guides when they stand alone.
const mixedCaseNamePattern = /\b\p{Lu}\p{Ll}+\p{Lu}[\p{L}\p{N}]*\b/gu;
const singleTitleCaseNamePattern = /^\p{Lu}[\p{L}\p{N}]*\p{Ll}[\p{L}\p{N}]*$/u;
const singleTechnologyNamePattern =
  /^(?:\p{Lu}{2,}(?:[+-][\p{Lu}\p{N}]+)*|\p{Lu}\p{Ll}+\p{Lu}[\p{L}\p{N}]*)$/u;
const compositionalNameWordPattern = /^\p{Lu}[\p{L}'’-]*$/u;
const wholeEvidenceWordPattern = /[\p{L}]+(?:['’-][\p{L}]+)*/gu;
const possessiveProtectedNamePattern = /^([\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*)'s$/u;
const wholeEvidenceNamePattern = /[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/gu;
const standaloneStrongWordPattern =
  /(?<![\p{L}\p{N}\\])\*\*([\p{L}]+(?:['’-][\p{L}]+)*)\*\*(?![\p{L}\p{N}])/gu;
const softwareObjectPattern =
  /^[ \t]+(?:tools?|tooling|applications?|apps?|services?|systems?|software|integrations?|adapters?|pipelines?|libraries|library|tests?|infrastructure|components?|clients?)(?![\p{L}\p{N}])/u;

const multiWordNamePattern = /\b\p{Lu}[\p{L}'’-]+(?:\s+\p{Lu}[\p{L}'’-]+)+\b/gu;

const protectedValuePatterns = [
  /https?:\/\/[^\s)]+/giu,
  /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu,
  protectedNumberPattern,
  /\b[\p{Lu}]{2,}(?:[+-][\p{Lu}\p{N}]+)*\b/gu,
  multiWordNamePattern,
  /\b(?:at|for)\s+(\p{Lu}[\p{L}'’-]+)\b/gu,
  mixedCaseNamePattern,
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

function normalizedNameIdentity(value: string): string {
  return normalizedIdentity(value).replace(/’/gu, "'");
}

function supportsPossessiveProtectedName(
  evidence: string,
  protectedValue: string,
): boolean | undefined {
  const normalizedValue = normalizedNameIdentity(protectedValue);
  const baseName = possessiveProtectedNamePattern.exec(normalizedValue)?.[1];
  if (baseName === undefined) return undefined;

  const evidenceNames = normalizedNameIdentity(evidence).match(wholeEvidenceNamePattern) ?? [];
  return evidenceNames.some((name) => name === baseName || name === normalizedValue);
}

/**
 * Permit uncertain descriptive-name composition only when each capitalized
 * word occurs as a whole word in this one evidence chunk and one source
 * adjacent pair is preserved. This is lexical support, not a check of meaning.
 */
function supportsCompositionalMultiwordValue(evidence: string, protectedValue: string): boolean {
  const words = protectedValue.normalize("NFKC").trim().split(/\s+/u);
  if (words.length < 2 || words.some((word) => !compositionalNameWordPattern.test(word))) {
    return false;
  }

  const remaining = new Map<string, number>();
  const normalizedWords = words.map(normalizedIdentity);
  for (const word of words) {
    const normalizedWord = normalizedIdentity(word);
    remaining.set(normalizedWord, (remaining.get(normalizedWord) ?? 0) + 1);
  }
  let hasSourceAdjacentPair = false;
  for (const line of evidence.split(/\r\n|\n|\r/u)) {
    if (line.includes("`")) continue;
    const wholeWordText = line.replace(standaloneStrongWordPattern, "$1").replace(/\*\*/gu, "x");
    const sourceWords = normalizedIdentity(wholeWordText).match(wholeEvidenceWordPattern) ?? [];
    for (const [index, sourceWord] of sourceWords.entries()) {
      if (
        normalizedWords.includes(sourceWord) &&
        normalizedWords.includes(sourceWords[index + 1] ?? "")
      ) {
        hasSourceAdjacentPair = true;
      }
      const count = remaining.get(sourceWord);
      if (count === undefined) continue;
      if (count === 1) remaining.delete(sourceWord);
      else remaining.set(sourceWord, count - 1);
    }
  }
  return remaining.size === 0 && hasSourceAdjacentPair;
}

/** Match numbers with their units and mixed-case names as whole tokens. */
export function supportsProtectedValue(evidence: string, protectedValue: string): boolean {
  const experienceSupport = supportsExperienceClaim(evidence, protectedValue);
  if (experienceSupport !== undefined) return experienceSupport;
  const value = normalizedIdentity(protectedValue);
  const source = normalizedIdentity(evidence);
  if (/^\d/u.test(value)) {
    return (
      [...source.matchAll(protectedNumberPattern)].some((match) => match[0] === value) ||
      supportsProtectedValueParaphrase(source, value)
    );
  }
  const possessiveNameSupport = supportsPossessiveProtectedName(evidence, protectedValue);
  if (possessiveNameSupport !== undefined) return possessiveNameSupport;
  if (singleTitleCaseNamePattern.test(protectedValue)) {
    return (source.match(/[\p{L}\p{N}]+/gu) ?? []).some((token) => token === value);
  }
  if (/\s/u.test(value)) {
    if (source.replace(/\s+/gu, " ").includes(value.replace(/\s+/gu, " "))) return true;
    return (
      supportsInlineStrongMultiwordName(evidence, protectedValue) ||
      supportsCompositionalMultiwordValue(evidence, protectedValue)
    );
  }
  return source.includes(value);
}

/** Keep wrapped identities within a chunk, but detect experience contradictions across chunks. */
export function supportsProtectedValueInChunks(
  evidenceChunks: readonly string[],
  protectedValue: string,
): boolean {
  return (
    supportsExperienceClaim(evidenceChunks.join("\n"), protectedValue) ??
    evidenceChunks.some((chunk) => supportsProtectedValue(chunk, protectedValue))
  );
}

/** Split only an opening action, one technical name, and a software-object noun. */
function withoutOpeningAction(text: string, matched: string, start: number): string {
  if (text.slice(0, start).trim() !== "") return matched;
  const parts = matched.split(/\s+/u);
  const [verb, name] = parts;
  if (
    parts.length !== 2 ||
    verb === undefined ||
    name === undefined ||
    !narrowOpeningActionVerbs.has(verb) ||
    !singleTechnologyNamePattern.test(name) ||
    (!softwareObjectPattern.test(text.slice(start + matched.length)) &&
      !softwareObjectAppositivePattern.test(text.slice(start + matched.length)))
  )
    return matched;
  return name;
}

/** Extract protected identities, then append canonical explicit experience statements. */
export function extractProtectedValues(value: string): readonly string[] {
  const experienceValues = experienceClaimValues(value);
  if (experienceValues !== undefined) return Object.freeze([...experienceValues]);
  const matches: ProtectedValueMatch[] = protectedValuePatterns.flatMap((pattern, patternIndex) =>
    [...value.matchAll(pattern)].flatMap((match, matchIndex) => {
      const raw = match[1] ?? match[0];
      const start = match.index ?? 0;
      const softwareParts =
        pattern === multiWordNamePattern
          ? protectedSoftwareDescriptionParts(value, raw, start)
          : [];
      if (softwareParts.length > 0) {
        return softwareParts.map((part, partIndex) => ({
          value: part.value,
          start: part.start,
          patternIndex,
          matchIndex: matchIndex * 2 + partIndex,
        }));
      }
      const narrow = withoutOpeningAction(value, raw, start);
      const extracted =
        pattern === multiWordNamePattern && narrow === raw
          ? withoutOpeningActionVerb(value, raw, start)
          : narrow;
      const captureOffset = match[0].indexOf(extracted);
      return [
        {
          value: extracted,
          start: start + Math.max(captureOffset, 0),
          patternIndex,
          matchIndex,
        },
      ];
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
  for (const experience of sourceExperienceValues(value)) {
    if (!seen.has(normalizedIdentity(experience))) extracted.push(experience);
    seen.add(normalizedIdentity(experience));
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
