/**
 * Bridge contract for where each career fact may be used (#2259): on a CV, only in interview, or
 * never. Levels cross the bridge by section (fact category) and by fact usage key, never as fact
 * text. Hosts without them leave these capabilities out, and the profile then shows no usage
 * controls.
 */

import type { CanonicalCandidateProfileFactCategory } from "@draft-loop/domain";
import { canonicalCandidateProfileFactCategories } from "@draft-loop/domain";
import {
  type FactUsageLevel,
  factUsageKeyPattern,
  isFactUsageLevel,
  maximumFactUsageEntries,
} from "@draft-loop/domain/fact-usage";

export interface FactUsageView {
  readonly sections: Readonly<
    Partial<Record<CanonicalCandidateProfileFactCategory, FactUsageLevel>>
  >;
  readonly facts: Readonly<Record<string, FactUsageLevel>>;
}

export type FactUsageChangeView =
  | {
      readonly kind: "section";
      readonly category: CanonicalCandidateProfileFactCategory;
      readonly level: FactUsageLevel | null;
    }
  | { readonly kind: "fact"; readonly key: string; readonly level: FactUsageLevel | null };

export interface FactUsageGetInput {
  readonly workspaceId: string;
}

export interface FactUsageSetInput {
  readonly workspaceId: string;
  readonly change: FactUsageChangeView;
}

export interface FactUsageResult {
  readonly workspaceId: string;
  readonly usage: FactUsageView;
}

type Raw = Readonly<Record<string, unknown>>;

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:/+@-]{0,127}$/u;

function record(value: unknown): Raw | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Raw)
    : undefined;
}

function onlyKeys(value: Raw, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function identifier(value: unknown): string | undefined {
  return typeof value === "string" && identifierPattern.test(value) ? value : undefined;
}

function category(value: unknown): CanonicalCandidateProfileFactCategory | undefined {
  return typeof value === "string" &&
    (canonicalCandidateProfileFactCategories as readonly string[]).includes(value)
    ? (value as CanonicalCandidateProfileFactCategory)
    : undefined;
}

function level(value: unknown): FactUsageLevel | null | undefined {
  if (value === null) return null;
  return isFactUsageLevel(value) ? value : undefined;
}

export function normalizeFactUsageView(value: unknown): FactUsageView | undefined {
  const raw = record(value);
  if (raw === undefined || !onlyKeys(raw, ["sections", "facts"])) return undefined;
  const rawSections = record(raw.sections);
  const rawFacts = record(raw.facts);
  if (rawSections === undefined || rawFacts === undefined) return undefined;
  const sections: Partial<Record<CanonicalCandidateProfileFactCategory, FactUsageLevel>> = {};
  for (const [key, entry] of Object.entries(rawSections)) {
    const section = category(key);
    if (section === undefined || !isFactUsageLevel(entry)) return undefined;
    sections[section] = entry;
  }
  const entries = Object.entries(rawFacts);
  if (entries.length > maximumFactUsageEntries) return undefined;
  const facts: Record<string, FactUsageLevel> = {};
  for (const [key, entry] of entries) {
    if (!factUsageKeyPattern.test(key) || !isFactUsageLevel(entry)) return undefined;
    facts[key] = entry;
  }
  return { sections, facts };
}

export function validateFactUsageGetInput(value: unknown): FactUsageGetInput | undefined {
  const raw = record(value);
  if (raw === undefined || !onlyKeys(raw, ["workspaceId"])) return undefined;
  const workspaceId = identifier(raw.workspaceId);
  return workspaceId === undefined ? undefined : { workspaceId };
}

function validateChange(value: unknown): FactUsageChangeView | undefined {
  const raw = record(value);
  if (raw === undefined) return undefined;
  const chosen = level(raw.level);
  if (chosen === undefined) return undefined;
  if (raw.kind === "section" && onlyKeys(raw, ["kind", "category", "level"])) {
    const section = category(raw.category);
    return section === undefined
      ? undefined
      : { kind: "section", category: section, level: chosen };
  }
  if (
    raw.kind === "fact" &&
    onlyKeys(raw, ["kind", "key", "level"]) &&
    typeof raw.key === "string" &&
    factUsageKeyPattern.test(raw.key)
  ) {
    return { kind: "fact", key: raw.key, level: chosen };
  }
  return undefined;
}

export function validateFactUsageSetInput(value: unknown): FactUsageSetInput | undefined {
  const raw = record(value);
  if (raw === undefined || !onlyKeys(raw, ["workspaceId", "change"])) return undefined;
  const workspaceId = identifier(raw.workspaceId);
  const change = validateChange(raw.change);
  return workspaceId === undefined || change === undefined ? undefined : { workspaceId, change };
}

export function normalizeFactUsageResult(value: unknown): FactUsageResult | undefined {
  const raw = record(value);
  if (raw === undefined || !onlyKeys(raw, ["workspaceId", "usage"])) return undefined;
  const workspaceId = identifier(raw.workspaceId);
  const usage = normalizeFactUsageView(raw.usage);
  return workspaceId === undefined || usage === undefined ? undefined : { workspaceId, usage };
}
