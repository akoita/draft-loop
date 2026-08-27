import { hasRequiredArtifactSection } from "@draft-loop/artifacts";
import type {
  DraftArtifact,
  JobRequirement,
  OutputConstraints,
  WritingPolicy,
  WritingPolicyRule,
} from "@draft-loop/schemas";

export type ValidationSeverity = "error" | "warning";

export const validationCategories = [
  "format",
  "factuality",
  "coverage",
  "evidence",
  "quality",
] as const;

export type ValidationCategory = (typeof validationCategories)[number];

/**
 * Stable codes emitted by the deterministic checks in this package.
 * Consumers should use the code and affected ids rather than parsing messages.
 */
export type DeterministicValidationCode =
  | "missing-required-section"
  | "max-words-exceeded"
  | "max-characters-exceeded"
  | "max-length-exceeded"
  | "duplicate-content"
  | "unsupported-claim"
  | "unsupported-quantification"
  | "inconsistent-date"
  | "writing-policy-ascii-punctuation"
  | "writing-policy-forbidden-character"
  | "writing-policy-forbidden-term"
  | "uncovered-requirement"
  | "explicit-gap";

export interface ValidationIssue {
  readonly code: string;
  readonly severity: ValidationSeverity;
  readonly message: string;
  /** Present for deterministic findings; optional to preserve the old contract. */
  readonly category?: ValidationCategory;
  readonly claimId?: string;
  readonly sectionId?: string;
  readonly requirementId?: string;
  readonly ruleId?: string;
  readonly blockId?: string;
  readonly location?: {
    readonly start: number;
    readonly end: number;
    readonly line: number;
    readonly column: number;
  };
}

export type ValidationFinding = ValidationIssue;

export interface ValidationResult {
  readonly issues: readonly ValidationIssue[];
  readonly valid: boolean;
}

type DeterministicWritingPolicy = Pick<WritingPolicy, "content" | "version"> & {
  readonly rules?: readonly WritingPolicyRule[];
};

export interface DeterministicValidationContext {
  readonly requirements: readonly Pick<JobRequirement, "id" | "text" | "priority">[];
  readonly outputConstraints: Pick<
    OutputConstraints,
    "requiredSections" | "maxWords" | "maxCharacters" | "maxLength"
  >;
  readonly writingPolicy?: DeterministicWritingPolicy;
}

export interface DeterministicValidationOptions {
  readonly explicitGapRequirementIds?: readonly string[];
}

const stopWords = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "into",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
]);

function normalizeText(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
}

function tokens(value: string): readonly string[] {
  return [...normalizeText(value).matchAll(/[\p{L}\p{N}]+/gu)]
    .map((match) => match[0])
    .filter((token) => token.length > 1 && !stopWords.has(token));
}

function artifactText(artifact: DraftArtifact): string {
  return artifact.sections
    .flatMap((section) => section.blocks.map((block) => block.text))
    .join("\n");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function writingPolicyRulePattern(rule: WritingPolicyRule): RegExp {
  if (rule.kind === "forbidden-characters") {
    return new RegExp(
      `(?:${[...rule.characters].map((character) => escapeRegExp(character)).join("|")})`,
      "gu",
    );
  }
  const prefix = rule.wholeWord ? "(?<![\\p{L}\\p{N}_])" : "";
  const suffix = rule.wholeWord ? "(?![\\p{L}\\p{N}_])" : "";
  const flags = rule.caseSensitive ? "gu" : "giu";
  return new RegExp(`${prefix}${escapeRegExp(rule.term)}${suffix}`, flags);
}

function writingPolicyLocation(
  text: string,
  start: number,
  end: number,
): NonNullable<ValidationIssue["location"]> {
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const line = text.slice(0, start).split("\n").length;
  return { start, end, line, column: start - lineStart + 1 };
}

interface WritingPolicyMatch {
  readonly sectionIndex: number;
  readonly blockIndex: number;
  readonly ruleIndex: number;
  readonly sectionId: string;
  readonly blockId: string;
  readonly rule: WritingPolicyRule;
  readonly location: NonNullable<ValidationIssue["location"]>;
}

function structuredWritingPolicyMatches(
  artifact: DraftArtifact,
  rules: readonly WritingPolicyRule[],
): readonly WritingPolicyMatch[] {
  const matches: WritingPolicyMatch[] = [];
  artifact.sections.forEach((section, sectionIndex) => {
    section.blocks.forEach((block, blockIndex) => {
      rules.forEach((rule, ruleIndex) => {
        for (const match of block.text.matchAll(writingPolicyRulePattern(rule))) {
          const matched = match[0];
          const start = match.index;
          if (matched === undefined || start === undefined) continue;
          matches.push({
            sectionIndex,
            blockIndex,
            ruleIndex,
            sectionId: section.id,
            blockId: block.id,
            rule,
            location: writingPolicyLocation(block.text, start, start + matched.length),
          });
        }
      });
    });
  });
  return matches.sort(
    (left, right) =>
      left.sectionIndex - right.sectionIndex ||
      left.blockIndex - right.blockIndex ||
      left.location.start - right.location.start ||
      left.ruleIndex - right.ruleIndex,
  );
}

function addStructuredWritingPolicyFindings(
  artifact: DraftArtifact,
  policy: Pick<DeterministicWritingPolicy, "version" | "rules">,
  issues: ValidationIssue[],
): void {
  if (policy.rules === undefined) return;
  for (const match of structuredWritingPolicyMatches(artifact, policy.rules)) {
    addIssue(issues, {
      code:
        match.rule.kind === "forbidden-term"
          ? "writing-policy-forbidden-term"
          : "writing-policy-forbidden-character",
      category: "format",
      severity: "warning",
      message: `draft violates writing policy ${policy.version} rule ${match.rule.id}`,
      sectionId: match.sectionId,
      ruleId: match.rule.id,
      blockId: match.blockId,
      location: match.location,
    });
  }
}

function wordCount(value: string): number {
  const trimmed = value.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/u).length;
}

function addIssue(
  issues: ValidationIssue[],
  issue: ValidationIssue & { readonly category: ValidationCategory },
): void {
  issues.push(issue);
}

function metricKey(match: string): string {
  const normalized = match.normalize("NFKC").toLowerCase();
  const numberMatch = normalized.match(/\d[\d,]*(?:\.\d+)?/u);
  if (numberMatch === null) {
    return normalized.replace(/\s+/gu, "");
  }

  const number = Number(numberMatch[0].replaceAll(",", ""));
  const currency = /^\s*(?:[$€£¥]|usd\b|eur\b|gbp\b|jpy\b)/u.test(normalized) ? "currency:" : "";
  const percentage = /%|\bpercent(?:age)?\b/u.test(normalized) ? "%" : "";
  const suffixMatch = normalized.match(/[kmbx]\b/u);
  const suffix = suffixMatch ? suffixMatch[0] : "";
  return `${currency}${number}${suffix}${percentage}`;
}

function extractMetricKeys(value: string): readonly string[] {
  const keys: string[] = [];
  const pattern =
    /(?<![\p{L}\p{N}])(?:(?:[$€£¥]\s*)|(?:usd\s+|eur\s+|gbp\s+|jpy\s+))?\d[\d,]*(?:\.\d+)?(?:\s*(?:[kmbx]|%|percent|percentage))?(?![\p{L}\p{N}])/giu;

  for (const match of value.matchAll(pattern)) {
    const text = match[0];
    if (text === undefined) {
      continue;
    }
    const numberMatch = text.match(/\d[\d,]*(?:\.\d+)?/u);
    if (numberMatch === null) {
      continue;
    }
    const normalizedNumber = numberMatch[0].replaceAll(",", "");
    const number = Number(normalizedNumber);
    // Four-digit years are checked by the date rule, not as unsupported metrics.
    if (/^\d{4}$/u.test(normalizedNumber) && number >= 1000 && number <= 2999) {
      continue;
    }
    keys.push(metricKey(text));
  }

  return keys;
}

function extractYears(value: string): ReadonlySet<string> {
  return new Set(value.match(/\b\d{4}\b/gu) ?? []);
}

function hasImpossibleDateRange(text: string): boolean {
  const rangePattern = /\b(19\d{2}|20\d{2})\b\s*(?:-|–|—|to)\s*\b(19\d{2}|20\d{2})\b/gu;
  for (const match of text.matchAll(rangePattern)) {
    const start = Number.parseInt(match[1] ?? "0", 10);
    const end = Number.parseInt(match[2] ?? "0", 10);
    if (start > end) {
      return true;
    }
  }
  return false;
}

function hasDateConflict(claimText: string, evidenceText: string): boolean {
  if (hasImpossibleDateRange(claimText) || hasImpossibleDateRange(evidenceText)) {
    return true;
  }
  const claimYears = extractYears(claimText);
  const evidenceYears = extractYears(evidenceText);
  if (claimYears.size === 0 || evidenceYears.size === 0) {
    return false;
  }
  return [...claimYears].every((year) => !evidenceYears.has(year));
}

/**
 * A requirement is covered when at least half of its meaningful normalized
 * tokens (and at least one token) occur in the normalized artifact text. This
 * intentionally favors a small, explainable lexical signal over semantic
 * inference; stop words and one-character tokens are ignored.
 */
export const requirementCoverageHeuristic =
  "coverage = at least half of meaningful normalized requirement tokens, with at least one match";

function isRequirementCovered(requirement: Pick<JobRequirement, "text">, text: string): boolean {
  const requirementTokens = [...new Set(tokens(requirement.text))];
  if (requirementTokens.length === 0) {
    return false;
  }
  const artifactTokens = new Set(tokens(text));
  const matches = requirementTokens.filter((token) => artifactTokens.has(token)).length;
  return matches > 0 && matches / requirementTokens.length >= 0.5;
}

function freezeResult(issues: readonly ValidationIssue[]): ValidationResult {
  const frozenIssues = Object.freeze(
    issues.map((issue) =>
      Object.freeze({
        ...issue,
        ...(issue.location === undefined ? {} : { location: Object.freeze({ ...issue.location }) }),
      }),
    ),
  ) as readonly ValidationIssue[];
  return Object.freeze({
    issues: frozenIssues,
    valid: frozenIssues.every((issue) => issue.severity !== "error"),
  });
}

/**
 * Run local, deterministic checks over a schema-validated draft artifact.
 * Evidence excerpts are used only for matching; neither source text nor claim
 * text is copied into the returned diagnostics.
 */
export function validateDraftArtifact(
  artifact: DraftArtifact,
  context: DeterministicValidationContext,
  optionsOrGapIds: DeterministicValidationOptions | readonly string[] = {},
): ValidationResult {
  const explicitGapIds = new Set(
    Array.isArray(optionsOrGapIds)
      ? optionsOrGapIds
      : ((optionsOrGapIds as DeterministicValidationOptions).explicitGapRequirementIds ?? []),
  );
  const issues: ValidationIssue[] = [];
  const text = artifactText(artifact);
  const constraints = context.outputConstraints;
  if (context.writingPolicy !== undefined) {
    if (context.writingPolicy.rules === undefined) {
      if (
        /(?:plain\s+ascii\s+punctuation|no\s+em\s+dashes?|no\s+en\s+dashes?)/iu.test(
          context.writingPolicy.content,
        ) &&
        /[‐‑‒–—―‘’“”]/u.test(text)
      ) {
        addIssue(issues, {
          code: "writing-policy-ascii-punctuation",
          category: "format",
          severity: "warning",
          message: `draft violates writing policy ${context.writingPolicy.version}: use plain ASCII punctuation`,
        });
      }
    } else {
      addStructuredWritingPolicyFindings(artifact, context.writingPolicy, issues);
    }
  }
  for (const requiredSection of constraints.requiredSections ?? []) {
    if (!hasRequiredArtifactSection(artifact, requiredSection)) {
      addIssue(issues, {
        code: "missing-required-section",
        category: "format",
        severity: "error",
        message: "required section is missing",
      });
    }
  }

  const words = wordCount(text);
  if (constraints.maxWords !== undefined && words > constraints.maxWords) {
    addIssue(issues, {
      code: "max-words-exceeded",
      category: "format",
      severity: "error",
      message: "draft exceeds the maximum word count",
    });
  }

  const characters = text.length;
  if (constraints.maxCharacters !== undefined && characters > constraints.maxCharacters) {
    addIssue(issues, {
      code: "max-characters-exceeded",
      category: "format",
      severity: "error",
      message: "draft exceeds the maximum character count",
    });
  }
  if (constraints.maxLength !== undefined && characters > constraints.maxLength) {
    addIssue(issues, {
      code: "max-length-exceeded",
      category: "format",
      severity: "error",
      message: "draft exceeds the legacy maximum character length",
    });
  }

  const seenBlocks = new Set<string>();
  for (const section of artifact.sections) {
    for (const block of section.blocks) {
      const normalized = normalizeText(block.text);
      if (seenBlocks.has(normalized)) {
        addIssue(issues, {
          code: "duplicate-content",
          category: "quality",
          severity: "warning",
          message: "duplicate block content",
          sectionId: section.id,
        });
      } else {
        seenBlocks.add(normalized);
      }
    }
  }

  const seenClaims = new Set<string>();
  for (const claim of artifact.claims) {
    const normalized = normalizeText(claim.text);
    if (seenClaims.has(normalized)) {
      addIssue(issues, {
        code: "duplicate-content",
        category: "quality",
        severity: "warning",
        message: "duplicate claim content",
        claimId: claim.id,
        sectionId: claim.sectionId,
      });
    } else {
      seenClaims.add(normalized);
    }
  }

  for (const claim of artifact.claims) {
    if (!claim.substantive) {
      continue;
    }

    const evidenceText = claim.evidence.map((reference) => reference.excerpt).join("\n");
    if (claim.evidence.length === 0) {
      addIssue(issues, {
        code: "unsupported-claim",
        category: "evidence",
        severity: "error",
        message: "substantive claim is not linked to candidate-provided materials",
        claimId: claim.id,
        sectionId: claim.sectionId,
      });
    }

    const evidenceMetrics = new Set(extractMetricKeys(evidenceText));
    if (extractMetricKeys(claim.text).some((metric) => !evidenceMetrics.has(metric))) {
      addIssue(issues, {
        code: "unsupported-quantification",
        category: "factuality",
        severity: "error",
        message: "substantive claim contains a metric not linked to candidate-provided materials",
        claimId: claim.id,
        sectionId: claim.sectionId,
      });
    }

    if (hasDateConflict(claim.text, evidenceText)) {
      addIssue(issues, {
        code: "inconsistent-date",
        category: "factuality",
        severity: "error",
        message: "claim and candidate-provided materials contain non-overlapping years",
        claimId: claim.id,
        sectionId: claim.sectionId,
      });
    }
  }

  for (const requirement of context.requirements) {
    if (explicitGapIds.has(requirement.id)) {
      addIssue(issues, {
        code: "explicit-gap",
        category: "coverage",
        severity: "warning",
        message: "requirement is explicitly marked as a gap",
        requirementId: requirement.id,
      });
      continue;
    }
    if (!isRequirementCovered(requirement, text)) {
      addIssue(issues, {
        code: "uncovered-requirement",
        category: "coverage",
        severity: requirement.priority === "critical" ? "error" : "warning",
        message: "requirement is not covered by deterministic token matching",
        requirementId: requirement.id,
      });
    }
  }

  for (const requirementId of [...explicitGapIds].sort()) {
    if (!context.requirements.some((requirement) => requirement.id === requirementId)) {
      addIssue(issues, {
        code: "explicit-gap",
        category: "coverage",
        severity: "warning",
        message: "requirement is explicitly marked as a gap",
        requirementId,
      });
    }
  }

  return freezeResult(issues);
}

export const validateArtifact = validateDraftArtifact;
export const runDeterministicValidation = validateDraftArtifact;
