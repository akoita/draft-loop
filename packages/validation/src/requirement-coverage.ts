import type { DraftArtifact, JobRequirement } from "@draft-loop/schemas";

import { alternativeRequirementBranches } from "./alternative-coverage.js";
import { explicitDegreeCoverage } from "./degree-coverage.js";
import { blockStatesMaturityQualifiers, requiredMaturityQualifiers } from "./maturity-coverage.js";

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

function tokens(text: string): readonly string[] {
  return [
    ...text
      .normalize("NFKC")
      .toLowerCase()
      .matchAll(/[\p{L}\p{N}]+/gu),
  ]
    .map((match) => match[0])
    .filter((token) => token.length > 1 && !stopWords.has(token));
}

/** Number of meaningful tokens the coverage matcher counts for a requirement text. */
export function meaningfulRequirementTokenCount(text: string): number {
  return new Set(tokens(text)).size;
}

export const requirementCoverageHeuristic =
  "coverage = at least half of meaningful normalized requirement tokens within one artifact block, with at least one match, for at least one permitted alternative branch, with every organisation-maturity qualifier that branch states present in that same block; recognized explicit degree requirements use the strict degree rule";

export interface RequirementCoverageMatch {
  readonly covered: boolean;
  /** `protected-rule` for recognised degree requirements and maturity-qualified branches. */
  readonly basis: "lexical" | "protected-rule";
  /** Which closed rule applied; `lexical` only when no protected rule is involved. */
  readonly rule: "degree" | "maturity" | "lexical";
  /** Indexes into the flattened artifact blocks that satisfied the rule, in artifact order. */
  readonly blockIndexes: readonly number[];
}

/**
 * Single source of truth for block-local coverage. Degree requirements report every
 * satisfying block; other requirements report the first satisfying block.
 */
export function findRequirementCoverage(
  requirement: Pick<JobRequirement, "text">,
  artifact: Pick<DraftArtifact, "sections">,
): RequirementCoverageMatch {
  const blocks = artifact.sections.flatMap((section) => section.blocks.map((block) => block.text));
  if (explicitDegreeCoverage(requirement.text, blocks) !== undefined) {
    const blockIndexes = blocks.flatMap((text, index) =>
      explicitDegreeCoverage(requirement.text, [text]) === true ? [index] : [],
    );
    return {
      covered: blockIndexes.length > 0,
      basis: "protected-rule",
      rule: "degree",
      blockIndexes,
    };
  }
  const branches = (alternativeRequirementBranches(requirement.text) ?? [requirement.text])
    .map((branch) => ({
      required: [...new Set(tokens(branch))],
      maturity: requiredMaturityQualifiers(branch),
    }))
    .filter((branch) => branch.required.length > 0);
  const maturity = branches.some((branch) => branch.maturity !== undefined);
  const index = blocks.findIndex((text) => {
    const available = new Set(tokens(text));
    return branches.some((branch) => {
      if (branch.maturity !== undefined && !blockStatesMaturityQualifiers(text, branch.maturity)) {
        return false;
      }
      const matches = branch.required.filter((token) => available.has(token)).length;
      return matches > 0 && matches / branch.required.length >= 0.5;
    });
  });
  return {
    covered: index >= 0,
    basis: maturity ? "protected-rule" : "lexical",
    rule: maturity ? "maturity" : "lexical",
    blockIndexes: index >= 0 ? [index] : [],
  };
}

/** Block-local coverage with closed degree, alternative, and maturity rules; not evidence verification. */
export function isRequirementCoveredByBlock(
  requirement: Pick<JobRequirement, "text">,
  artifact: Pick<DraftArtifact, "sections">,
): boolean {
  return findRequirementCoverage(requirement, artifact).covered;
}
