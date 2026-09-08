import type { DraftArtifact, JobRequirement } from "@draft-loop/schemas";

import { explicitDegreeCoverage } from "./degree-coverage.js";

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
  "coverage = at least half of meaningful normalized requirement tokens within one artifact block, with at least one match; recognized explicit degree requirements use the strict degree rule";

/** Block-local coverage with a closed degree rule; not general evidence verification. */
export function isRequirementCoveredByBlock(
  requirement: Pick<JobRequirement, "text">,
  artifact: Pick<DraftArtifact, "sections">,
): boolean {
  const degree = explicitDegreeCoverage(
    requirement.text,
    artifact.sections.flatMap((section) => section.blocks.map((block) => block.text)),
  );
  if (degree !== undefined) return degree;
  const required = [...new Set(tokens(requirement.text))];
  if (required.length === 0) return false;
  return artifact.sections.some((section) =>
    section.blocks.some((block) => {
      const available = new Set(tokens(block.text));
      const matches = required.filter((token) => available.has(token)).length;
      return matches > 0 && matches / required.length >= 0.5;
    }),
  );
}
