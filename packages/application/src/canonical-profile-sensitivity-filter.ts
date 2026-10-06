import {
  classifySourceSections,
  type SourceSensitivityRule,
  type SourceSensitivityTier,
} from "@draft-loop/domain/source-sensitivity";
import type {
  CanonicalCandidateProfileExtractionProposal,
  CanonicalCandidateProfileProvenanceReference,
} from "@draft-loop/schemas";

import { parseCanonicalCandidateProfileExtractionProposal } from "./candidate-profile-proposal-validation.js";
import { excludedSensitivityTiersForConsent } from "./sensitive-knowledge-consent.js";

/**
 * Sensitivity tiers withheld from canonical profile derivation when the workspace has not allowed
 * sensitive sections: the consent-off policy. A workspace that consented passes
 * `excludedSensitivityTiersForConsent(true)` instead.
 */
export const canonicalProfileExcludedSensitivityTiers: ReadonlySet<SourceSensitivityTier> =
  excludedSensitivityTiersForConsent(false);

/** Joins kept sections that were separated by a removed section. */
const removedSectionJoin = "\n\n";

/** One UTF-16 range of the ORIGINAL source text that must never reach a provider. */
export interface CanonicalProfileExcludedRange {
  readonly start: number;
  readonly end: number;
}

/**
 * Local-only evidence that a source's text was filtered. It holds the original text and is never
 * part of a provider request.
 */
export interface CanonicalProfileSourceSensitivityGuard {
  readonly originalText: string;
  readonly excludedRanges: readonly CanonicalProfileExcludedRange[];
}

export type CanonicalProfileSourceSensitivityFilter =
  | { readonly status: "unchanged" }
  | {
      readonly status: "filtered";
      readonly text: string;
      readonly guard: CanonicalProfileSourceSensitivityGuard;
    }
  | { readonly status: "fully-excluded" };

/** Rules version that filtered one knowledge base's sources during a derivation. */
export interface CanonicalProfileSensitivityRulesApplied {
  readonly storeId: string;
  readonly knowledgeBaseId: string;
  readonly rulesVersion: number;
  readonly rulesChecksum: string;
}

/**
 * Remove excluded sections from one normalized source. Only Markdown can be sectioned; any other
 * media type, a knowledge base without rules, or a source with nothing excluded is unchanged.
 */
export function filterSourceTextForCanonicalProfile(
  text: string,
  mediaType: string,
  rules: readonly SourceSensitivityRule[] | undefined,
  excludedTiers: ReadonlySet<SourceSensitivityTier> = canonicalProfileExcludedSensitivityTiers,
): CanonicalProfileSourceSensitivityFilter {
  if (rules === undefined || rules.length === 0 || mediaType !== "text/markdown") {
    return { status: "unchanged" };
  }
  const sections = classifySourceSections(text, rules);
  if (!sections.some((section) => excludedTiers.has(section.tier))) {
    return { status: "unchanged" };
  }

  const excludedRanges: CanonicalProfileExcludedRange[] = [];
  const keptSegments: string[] = [];
  let segmentStart: number | undefined;
  let segmentEnd = 0;
  const closeSegment = (): void => {
    if (segmentStart !== undefined) keptSegments.push(text.slice(segmentStart, segmentEnd));
    segmentStart = undefined;
  };
  for (const section of sections) {
    if (excludedTiers.has(section.tier)) {
      closeSegment();
      excludedRanges.push({ start: section.start, end: section.end });
      continue;
    }
    segmentStart ??= section.start;
    segmentEnd = section.end;
  }
  closeSegment();

  const filtered = keptSegments.join(removedSectionJoin);
  if (filtered.trim().length === 0) return { status: "fully-excluded" };
  return {
    status: "filtered",
    text: filtered,
    guard: { originalText: text, excludedRanges },
  };
}

/** Matches the evidence grounding normalization, kept per character so positions can be mapped back. */
function normalizeQuote(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

interface NormalizedOriginal {
  readonly text: string;
  readonly starts: readonly number[];
  readonly ends: readonly number[];
}

/**
 * Normalize the original text like evidence grounding does while remembering the original UTF-16
 * range of every normalized character. Normalization runs per base character with its combining
 * marks, so a rare cross-segment composition (for example decomposed Hangul) can fail to match;
 * that only drops a fact and never keeps one.
 */
function normalizeOriginalWithPositions(original: string): NormalizedOriginal {
  const characters: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  for (const segment of original.matchAll(/\p{M}*\P{M}\p{M}*|\p{M}+/gu)) {
    const segmentStart = segment.index ?? 0;
    const segmentEnd = segmentStart + segment[0].length;
    for (const character of segment[0].normalize("NFKC").toLowerCase()) {
      const isSpace = /\s/u.test(character);
      if (isSpace && characters.at(-1) === " ") {
        ends[ends.length - 1] = segmentEnd;
        continue;
      }
      characters.push(isSpace ? " " : character);
      starts.push(segmentStart);
      ends.push(segmentEnd);
    }
  }
  const joined = characters.join("");
  // Characters are code points, so keep one position per UTF-16 unit of the joined string.
  const unitStarts: number[] = [];
  const unitEnds: number[] = [];
  characters.forEach((character, index) => {
    for (let unit = 0; unit < character.length; unit += 1) {
      unitStarts.push(starts[index] ?? 0);
      unitEnds.push(ends[index] ?? 0);
    }
  });
  const leading = joined.length - joined.trimStart().length;
  const trimmed = joined.trim();
  return {
    text: trimmed,
    starts: unitStarts.slice(leading, leading + trimmed.length),
    ends: unitEnds.slice(leading, leading + trimmed.length),
  };
}

function overlapsExcluded(
  start: number,
  end: number,
  ranges: readonly CanonicalProfileExcludedRange[],
): boolean {
  return ranges.some((range) => start < range.end && range.start < end);
}

/**
 * Whether the quote occurs in the original text at least once entirely outside every excluded
 * range. A quote that only exists in excluded text, or that spans an artificial join, has no such
 * occurrence.
 */
export function createCanonicalProfileQuoteLocator(
  guard: CanonicalProfileSourceSensitivityGuard,
): (quote: string) => boolean {
  let normalized: NormalizedOriginal | undefined;
  return (quote) => {
    const needle = normalizeQuote(quote);
    if (needle.length === 0) return false;
    normalized ??= normalizeOriginalWithPositions(guard.originalText);
    let from = 0;
    while (from <= normalized.text.length - needle.length) {
      const index = normalized.text.indexOf(needle, from);
      if (index === -1) return false;
      const start = normalized.starts[index] ?? 0;
      const end = normalized.ends[index + needle.length - 1] ?? guard.originalText.length;
      if (!overlapsExcluded(start, end, guard.excludedRanges)) return true;
      from = index + 1;
    }
    return false;
  };
}

function referenceKey(reference: CanonicalCandidateProfileProvenanceReference): string {
  return JSON.stringify([
    reference.storeId,
    reference.knowledgeBaseId,
    reference.sourceId,
    reference.versionId,
    reference.kind,
  ]);
}

interface GuardedMaterial {
  readonly reference: CanonicalCandidateProfileProvenanceReference;
  readonly sensitivity?: CanonicalProfileSourceSensitivityGuard;
}

/**
 * Quote locators per deduplicated representative source. A representative may stand for several
 * references; a quote must qualify under every guarded reference.
 */
export function canonicalProfileQuoteLocatorsByRepresentativeId(
  materials: readonly GuardedMaterial[],
  referencesByRepresentativeId: ReadonlyMap<
    string,
    readonly CanonicalCandidateProfileProvenanceReference[]
  >,
): ReadonlyMap<string, readonly ((quote: string) => boolean)[]> {
  const locatorsByReference = new Map<string, (quote: string) => boolean>();
  for (const material of materials) {
    if (material.sensitivity === undefined) continue;
    locatorsByReference.set(
      referenceKey(material.reference),
      createCanonicalProfileQuoteLocator(material.sensitivity),
    );
  }
  const byRepresentative = new Map<string, readonly ((quote: string) => boolean)[]>();
  if (locatorsByReference.size === 0) return byRepresentative;
  for (const [representativeId, references] of referencesByRepresentativeId) {
    const locators = references.flatMap((reference) => {
      const locator = locatorsByReference.get(referenceKey(reference));
      return locator === undefined ? [] : [locator];
    });
    if (locators.length > 0) byRepresentative.set(representativeId, locators);
  }
  return byRepresentative;
}

export interface SensitivityGuardedProposal {
  readonly proposal: CanonicalCandidateProfileExtractionProposal;
  /** Facts removed because an evidence quote has no occurrence outside the excluded ranges. */
  readonly droppedFacts: number;
}

/**
 * Final safety net before mapping a proposal into profile facts: drop every fact with an evidence
 * quote that cannot be found in the original text outside the excluded ranges, together with the
 * issues that cite a dropped fact.
 */
export function dropFactsQuotingExcludedText(
  proposal: CanonicalCandidateProfileExtractionProposal,
  locatorsByRepresentativeId: ReadonlyMap<string, readonly ((quote: string) => boolean)[]>,
): SensitivityGuardedProposal {
  if (locatorsByRepresentativeId.size === 0) return { proposal, droppedFacts: 0 };
  const facts = proposal.facts.filter((fact) =>
    fact.evidence.every((evidence) =>
      (locatorsByRepresentativeId.get(evidence.sourceId) ?? []).every((locate) =>
        locate(evidence.quote),
      ),
    ),
  );
  const droppedFacts = proposal.facts.length - facts.length;
  if (droppedFacts === 0) return { proposal, droppedFacts };
  const keptKeys = new Set(facts.map((fact) => fact.key));
  const issues = proposal.issues.filter((issue) =>
    issue.factKeys.every((key) => keptKeys.has(key)),
  );
  return {
    proposal: parseCanonicalCandidateProfileExtractionProposal({ ...proposal, facts, issues }),
    droppedFacts,
  };
}
