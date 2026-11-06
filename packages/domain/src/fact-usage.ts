/**
 * Usage level: where a career fact may be used (#2258, design: docs/design/interview-preparation.md).
 *
 * It is independent of the sensitivity tier. The tier decides what may reach a provider; the usage
 * level decides which outputs may use a fact. A usage level never loosens a tier: a `never-share`
 * section stays withheld whatever its usage level.
 *
 * The person sets a level on one fact or on a whole section (a fact category). A fact's own level
 * wins over its section's. An unset level reads as `cv`, so nothing changes until the person marks
 * a fact. Levels are keyed by the fact's content, not its id, so they survive a source refresh that
 * re-derives the profile with new ids.
 */

import {
  type CanonicalCandidateProfileFactCategory,
  canonicalCandidateProfileFactCategories,
} from "./canonical-candidate-profile.js";

export const factUsageLevels = ["cv", "interview-only", "never-say"] as const;

export type FactUsageLevel = (typeof factUsageLevels)[number];

/** The level a fact has when neither it nor its section has one. */
export const defaultFactUsageLevel: FactUsageLevel = "cv";

/** The outputs that draw on career facts. */
export const factUsagePurposes = ["cv", "interview"] as const;

export type FactUsagePurpose = (typeof factUsagePurposes)[number];

/** The most fact-level entries one workspace keeps, the profile's own fact bound. */
export const maximumFactUsageEntries = 2_048;

export const factUsageSettingsSchemaVersion = 1 as const;

/** `fu1-`, the fact category, `-` and 16 lowercase hex digits. */
export const factUsageKeyPattern = new RegExp(
  `^fu1-(?:${canonicalCandidateProfileFactCategories.join("|")})-[0-9a-f]{16}$`,
  "u",
);

export interface FactUsageSettings {
  readonly schemaVersion: typeof factUsageSettingsSchemaVersion;
  /** Levels set on a whole section, by fact category. */
  readonly sections: Readonly<
    Partial<Record<CanonicalCandidateProfileFactCategory, FactUsageLevel>>
  >;
  /** Levels set on one fact, by its usage key. */
  readonly facts: Readonly<Record<string, FactUsageLevel>>;
}

export const emptyFactUsageSettings: FactUsageSettings = Object.freeze({
  schemaVersion: factUsageSettingsSchemaVersion,
  sections: Object.freeze({}),
  facts: Object.freeze({}),
});

/** The parts of a profile fact its usage key is made from. */
export interface FactUsageSubject {
  readonly category: CanonicalCandidateProfileFactCategory;
  readonly field: string;
  readonly value: string;
}

function normalized(text: string): string {
  return text.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

const fnvOffset = 0xcbf29ce484222325n;
const fnvPrime = 0x100000001b3n;
const mask64 = 0xffffffffffffffffn;

/** 64-bit FNV-1a over UTF-16 code units: stable, dependency-free, and the same in the browser. */
function fnv1a64(text: string): string {
  let hash = fnvOffset;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= BigInt(text.charCodeAt(index));
    hash = (hash * fnvPrime) & mask64;
  }
  return hash.toString(16).padStart(16, "0");
}

/**
 * A fact's usage key: its category and a hash of its normalized field and value. Two facts with
 * the same content share a key, and the key holds no fact text.
 */
export function factUsageKey(fact: FactUsageSubject): string {
  return `fu1-${fact.category}-${fnv1a64(`${normalized(fact.field)}\u0000${normalized(fact.value)}`)}`;
}

export function isFactUsageLevel(value: unknown): value is FactUsageLevel {
  return typeof value === "string" && (factUsageLevels as readonly string[]).includes(value);
}

/** The fact's level: its own, else its section's, else `cv`. */
export function resolveFactUsage(
  settings: FactUsageSettings,
  fact: FactUsageSubject,
): FactUsageLevel {
  return (
    settings.facts[factUsageKey(fact)] ?? settings.sections[fact.category] ?? defaultFactUsageLevel
  );
}

/** Whether a level allows a purpose: `cv` allows both, `interview-only` interviews, `never-say` none. */
export function factUsageAllows(level: FactUsageLevel, purpose: FactUsagePurpose): boolean {
  if (level === "never-say") return false;
  return level === "cv" || purpose === "interview";
}

/** The facts a purpose may use, in their original order. */
export function filterFactsForUsage<Fact extends FactUsageSubject>(
  facts: readonly Fact[],
  settings: FactUsageSettings,
  purpose: FactUsagePurpose,
): Fact[] {
  return facts.filter((fact) => factUsageAllows(resolveFactUsage(settings, fact), purpose));
}

/**
 * The settings with one level set or cleared. `undefined` clears it, so the fact or section falls
 * back to the next level. Setting a fact to its section's level is still stored, so a later section
 * change does not move it.
 */
export function withFactUsage(
  settings: FactUsageSettings,
  target:
    | { readonly kind: "section"; readonly category: CanonicalCandidateProfileFactCategory }
    | { readonly kind: "fact"; readonly key: string },
  level: FactUsageLevel | undefined,
): FactUsageSettings {
  if (target.kind === "section") {
    const sections = { ...settings.sections };
    if (level === undefined) delete sections[target.category];
    else sections[target.category] = level;
    return { ...settings, sections };
  }
  const facts = { ...settings.facts };
  if (level === undefined) delete facts[target.key];
  else facts[target.key] = level;
  return { ...settings, facts };
}
