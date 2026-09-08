import type { DraftArtifact, JobRequirement } from "@draft-loop/schemas";

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
  "coverage = at least half of meaningful normalized requirement tokens within one artifact block, with at least one match";

/** Lexical overlap within one block; not semantic entailment or evidence verification. */
export function isRequirementCoveredByBlock(
  requirement: Pick<JobRequirement, "text">,
  artifact: Pick<DraftArtifact, "sections">,
): boolean {
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
