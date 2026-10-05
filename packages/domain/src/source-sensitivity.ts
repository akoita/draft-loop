/**
 * Sensitivity tiers for knowledge-source sections.
 *
 * A Markdown knowledge source is split into heading sections, and an ordered
 * list of rules assigns each section a tier. Rules match headings, never
 * offsets, so they survive refreshes of the original file. This module is pure
 * and provider independent; persistence and enforcement live elsewhere.
 */

export const sourceSensitivityTiers = ["normal", "sensitive", "never-share"] as const;

export type SourceSensitivityTier = (typeof sourceSensitivityTiers)[number];

/** Tiers ordered from least to most restrictive. */
export const sourceSensitivityTierStrictness: Readonly<Record<SourceSensitivityTier, number>> =
  Object.freeze({ normal: 0, sensitive: 1, "never-share": 2 });

export type SourceSensitivityRuleMatch =
  | { readonly kind: "heading-contains"; readonly text: string }
  | { readonly kind: "heading-path"; readonly path: readonly string[] };

export interface SourceSensitivityRule {
  readonly id: string;
  readonly tier: SourceSensitivityTier;
  readonly match: SourceSensitivityRuleMatch;
}

export interface SourceSection {
  /** Heading texts from the top level down to this section; empty for the root section. */
  readonly headingPath: readonly string[];
  /** Heading level 1-6, or 0 for the root section before the first heading. */
  readonly level: number;
  /** UTF-16 offset of the first character of the section (its heading line). */
  readonly start: number;
  /** UTF-16 offset one past the last character of the section. */
  readonly end: number;
}

export interface ClassifiedSourceSection extends SourceSection {
  readonly tier: SourceSensitivityTier;
  /** Ids of the rules that matched this section or one of its ancestors. */
  readonly matchedRuleIds: readonly string[];
}

const headingPattern = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
const fencePattern = /^ {0,3}(`{3,}|~{3,})/;

function parseHeading(line: string): { level: number; text: string } | undefined {
  const match = headingPattern.exec(line);
  if (match === null) return undefined;
  const hashes = match[1] ?? "";
  const rawText = match[2] ?? "";
  // Remove an optional closing sequence of #s that is preceded by whitespace.
  const text = rawText
    .replace(/(?:^|[ \t]+)#+$/, "")
    .replace(/[ \t]+$/, "")
    .trim();
  return { level: hashes.length, text };
}

/**
 * Splits Markdown into contiguous heading sections that cover the whole text.
 *
 * Only ATX headings (`#` to `######`, up to three leading spaces) delimit
 * sections. Setext headings (underlined with `===` or `---`) are NOT
 * recognised, and lines inside fenced code blocks are never headings. Text
 * that is not under its own ATX heading cannot be tiered separately.
 */
export function partitionMarkdownSections(text: string): SourceSection[] {
  if (text.length === 0) return [];

  interface Boundary {
    readonly start: number;
    readonly level: number;
    readonly heading: string;
  }
  const boundaries: Boundary[] = [];
  let fence: { readonly char: string; readonly length: number } | undefined;
  let offset = 0;

  while (offset < text.length) {
    const newline = text.indexOf("\n", offset);
    const lineEnd = newline === -1 ? text.length : newline;
    const line = text.slice(offset, lineEnd).replace(/\r$/, "");

    const fenceMatch = fencePattern.exec(line);
    if (fence !== undefined) {
      const marker = fenceMatch?.[1];
      if (
        marker !== undefined &&
        marker[0] === fence.char &&
        marker.length >= fence.length &&
        line.trim() === marker
      ) {
        fence = undefined;
      }
    } else if (fenceMatch !== null) {
      const marker = fenceMatch[1] ?? "";
      // A backtick fence's info string may not contain backticks.
      if (!(marker[0] === "`" && line.slice(fenceMatch[0].length).includes("`"))) {
        fence = { char: marker[0] ?? "`", length: marker.length };
      }
    } else {
      const heading = parseHeading(line);
      if (heading !== undefined) {
        boundaries.push({ start: offset, level: heading.level, heading: heading.text });
      }
    }
    offset = lineEnd + 1;
  }

  const sections: SourceSection[] = [];
  const first = boundaries[0];
  if (first === undefined || first.start > 0) {
    sections.push({
      headingPath: [],
      level: 0,
      start: 0,
      end: first === undefined ? text.length : first.start,
    });
  }

  const stack: { level: number; heading: string }[] = [];
  for (const [index, boundary] of boundaries.entries()) {
    while (stack.length > 0 && (stack[stack.length - 1]?.level ?? 0) >= boundary.level) {
      stack.pop();
    }
    stack.push({ level: boundary.level, heading: boundary.heading });
    sections.push({
      headingPath: stack.map((entry) => entry.heading),
      level: boundary.level,
      start: boundary.start,
      end: boundaries[index + 1]?.start ?? text.length,
    });
  }
  return sections;
}

/** Lowercases, strips accents and Markdown emphasis markers, and collapses whitespace. */
export function normalizeHeadingText(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function ruleMatchesPath(rule: SourceSensitivityRule, normalizedPath: readonly string[]): boolean {
  const match = rule.match;
  if (match.kind === "heading-contains") {
    const needle = normalizeHeadingText(match.text);
    if (needle.length === 0) return false;
    return normalizedPath.some((heading) => heading.includes(needle));
  }
  const rulePath = match.path.map(normalizeHeadingText);
  if (rulePath.length === 0 || rulePath.length > normalizedPath.length) return false;
  return rulePath.every((heading, index) => heading === normalizedPath[index]);
}

/**
 * Assigns each section the strictest tier among rules matching its own heading
 * or any ancestor heading. Sections matching no rule are `normal`.
 */
export function classifySourceSections(
  text: string,
  rules: readonly SourceSensitivityRule[],
): ClassifiedSourceSection[] {
  return partitionMarkdownSections(text).map((section) => {
    const normalizedPath = section.headingPath.map(normalizeHeadingText);
    let tier: SourceSensitivityTier = "normal";
    const matchedRuleIds: string[] = [];
    for (const rule of rules) {
      if (!ruleMatchesPath(rule, normalizedPath)) continue;
      matchedRuleIds.push(rule.id);
      if (sourceSensitivityTierStrictness[rule.tier] > sourceSensitivityTierStrictness[tier]) {
        tier = rule.tier;
      }
    }
    return { ...section, tier, matchedRuleIds };
  });
}

function suggestion(
  id: string,
  tier: SourceSensitivityTier,
  text: string,
): Readonly<SourceSensitivityRule> {
  return Object.freeze({
    id,
    tier,
    match: Object.freeze({ kind: "heading-contains" as const, text }),
  });
}

/**
 * Rules offered to the user for confirmation. They are suggestions only and
 * must never be applied without explicit confirmation.
 */
export const defaultSourceSensitivityRuleSuggestions: readonly Readonly<SourceSensitivityRule>[] =
  Object.freeze([
    suggestion("suggest-compensation", "never-share", "compensation"),
    suggestion("suggest-salary", "never-share", "salary"),
    suggestion("suggest-interview-only", "never-share", "interview only"),
    suggestion("suggest-interview-material", "never-share", "interview material"),
    suggestion("suggest-confidential", "never-share", "confidential"),
    suggestion("suggest-private", "never-share", "private"),
    suggestion("suggest-never-goes-on", "never-share", "never goes on"),
    suggestion("suggest-contact", "sensitive", "contact"),
    suggestion("suggest-address", "sensitive", "address"),
    suggestion("suggest-phone", "sensitive", "phone"),
  ]);
