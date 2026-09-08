import type { ScoredEvidenceChunk } from "@draft-loop/domain";

import {
  experienceClaimValues,
  sourceExperienceValues,
  supportsExperienceClaim,
} from "./experience-grounding.js";

const protectedNumberPattern = /(?<![\p{L}\p{N}])\d+(?:[.,]\d+)*(?:%|[kmb])?(?![\p{L}\p{N}])/giu;

// Mixed-case names must also appear in source guides when they stand alone.
const mixedCaseNamePattern = /\b\p{Lu}\p{Ll}+\p{Lu}[\p{L}\p{N}]*\b/gu;
const singleTechnologyNamePattern =
  /^(?:\p{Lu}{2,}(?:[+-][\p{Lu}\p{N}]+)*|\p{Lu}\p{Ll}+\p{Lu}[\p{L}\p{N}]*)$/u;
const softwareObjectPattern =
  /^[ \t]+(?:tools?|tooling|applications?|apps?|services?|systems?|software|integrations?|adapters?|pipelines?|libraries|library|tests?|infrastructure|components?|clients?)(?![\p{L}\p{N}])/u;
const openingActionVerbs = new Set([
  "Built",
  "Implemented",
  "Developed",
  "Automated",
  "Deployed",
  "Migrated",
  "Optimized",
  "Refactored",
  "Integrated",
  "Tested",
]);

const protectedValuePatterns = [
  /https?:\/\/[^\s)]+/giu,
  /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu,
  protectedNumberPattern,
  /\b[\p{Lu}]{2,}(?:[+-][\p{Lu}\p{N}]+)*\b/gu,
  /\b\p{Lu}[\p{L}'’-]+(?:\s+\p{Lu}[\p{L}'’-]+)+\b/gu,
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

/** Match numbers with their units and mixed-case names as whole tokens. */
export function supportsProtectedValue(evidence: string, protectedValue: string): boolean {
  const experienceSupport = supportsExperienceClaim(evidence, protectedValue);
  if (experienceSupport !== undefined) return experienceSupport;
  const value = normalizedIdentity(protectedValue);
  const source = normalizedIdentity(evidence);
  if (/^\d/u.test(value)) {
    return [...source.matchAll(protectedNumberPattern)].some((match) => match[0] === value);
  }
  if (/^\p{Lu}\p{Ll}+\p{Lu}[\p{L}\p{N}]*$/u.test(protectedValue)) {
    return (source.match(/[\p{L}\p{N}]+/gu) ?? []).some((token) => token === value);
  }
  return source.includes(value);
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
    !openingActionVerbs.has(verb) ||
    !singleTechnologyNamePattern.test(name) ||
    !softwareObjectPattern.test(text.slice(start + matched.length))
  )
    return matched;
  return name;
}

/** Extract protected identities, then append canonical explicit experience statements. */
export function extractProtectedValues(value: string): readonly string[] {
  const experienceValues = experienceClaimValues(value);
  if (experienceValues !== undefined) return Object.freeze([...experienceValues]);
  const matches: ProtectedValueMatch[] = protectedValuePatterns.flatMap((pattern, patternIndex) =>
    [...value.matchAll(pattern)].map((match, matchIndex) => {
      const raw = match[1] ?? match[0];
      const extracted = withoutOpeningAction(value, raw, match.index ?? 0);
      const captureOffset = match[0].indexOf(extracted);
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
