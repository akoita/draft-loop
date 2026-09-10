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

export const requirementCoverageHeuristic =
  "coverage = at least half of meaningful normalized requirement tokens within one artifact block, with at least one match, for at least one permitted alternative branch, with every organisation-maturity qualifier that branch states present in that same block; recognized explicit degree requirements use the strict degree rule";

/** Block-local coverage with closed degree, alternative, and maturity rules; not evidence verification. */
export function isRequirementCoveredByBlock(
  requirement: Pick<JobRequirement, "text">,
  artifact: Pick<DraftArtifact, "sections">,
): boolean {
  const blocks = artifact.sections.flatMap((section) => section.blocks.map((block) => block.text));
  const degree = explicitDegreeCoverage(requirement.text, blocks);
  if (degree !== undefined) return degree;
  const branches = (alternativeRequirementBranches(requirement.text) ?? [requirement.text])
    .map((branch) => ({
      required: [...new Set(tokens(branch))],
      maturity: requiredMaturityQualifiers(branch),
    }))
    .filter((branch) => branch.required.length > 0);
  if (branches.length === 0) return false;
  return blocks.some((text) => {
    const available = new Set(tokens(text));
    return branches.some(({ required, maturity }) => {
      if (maturity !== undefined && !blockStatesMaturityQualifiers(text, maturity)) return false;
      const matches = required.filter((token) => available.has(token)).length;
      return matches > 0 && matches / required.length >= 0.5;
    });
  });
}
