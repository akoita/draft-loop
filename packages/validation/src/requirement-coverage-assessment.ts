import type { DraftArtifact, JobRequirement } from "@draft-loop/schemas";

import { findRequirementCoverage, type RequirementCoverageMatch } from "./requirement-coverage.js";

export const requirementCoverageStatuses = [
  "covered",
  "needs-judgement",
  "uncovered",
  "explicit-gap",
] as const;

export type RequirementCoverageStatus = (typeof requirementCoverageStatuses)[number];

export const requirementCoverageBases = [
  "lexical",
  "protected-rule",
  "semantic-candidate",
  "judgement",
] as const;

export type RequirementCoverageBasis = (typeof requirementCoverageBases)[number];

export interface RequirementCoverageEvidence {
  readonly blockId: string;
  readonly score?: number;
}

/**
 * One coverage verdict per requirement. The deterministic rule produces only
 * `covered`, `uncovered`, and `explicit-gap` with basis `lexical` or `protected-rule`;
 * `needs-judgement`, `semantic-candidate`, and `judgement` are reserved.
 */
export interface RequirementCoverageAssessment {
  readonly requirementId: string;
  readonly status: RequirementCoverageStatus;
  readonly basis: RequirementCoverageBasis;
  readonly evidence: readonly RequirementCoverageEvidence[];
  readonly rationale: string;
}

/** Fixed user-visible sentences; they never quote requirement or block text. */
export const requirementCoverageRationales = Object.freeze({
  // An explicit gap is an author declaration, not a matcher result, so it carries
  // the plain `lexical` basis rather than claiming a protected rule or judgement.
  explicitGap: "Marked as an explicit gap by the author.",
  lexicalCovered: "Covered by matching wording in one CV block.",
  lexicalUncovered: "Not covered: no CV block repeats enough of the requirement's wording.",
  degreeCovered: "Covered under the strict degree rule.",
  degreeUncovered: "Not covered under the strict degree rule.",
  maturityCovered: "Covered: the block states the required organisation stage.",
  maturityUncovered: "Not covered: no block states the required organisation stage.",
});

function rationaleFor(match: RequirementCoverageMatch): string {
  const rationales = requirementCoverageRationales;
  if (match.rule === "degree") {
    return match.covered ? rationales.degreeCovered : rationales.degreeUncovered;
  }
  if (match.rule === "maturity") {
    return match.covered ? rationales.maturityCovered : rationales.maturityUncovered;
  }
  return match.covered ? rationales.lexicalCovered : rationales.lexicalUncovered;
}

/** Assesses each requirement with the existing deterministic rule, in requirement order. */
export function assessRequirementCoverage(
  requirements: readonly Pick<JobRequirement, "id" | "text">[],
  artifact: Pick<DraftArtifact, "sections">,
  explicitGapIds: ReadonlySet<string> = new Set(),
): readonly RequirementCoverageAssessment[] {
  const blocks = artifact.sections.flatMap((section) => section.blocks);
  return Object.freeze(
    requirements.map((requirement): RequirementCoverageAssessment => {
      if (explicitGapIds.has(requirement.id)) {
        return Object.freeze({
          requirementId: requirement.id,
          status: "explicit-gap",
          basis: "lexical",
          evidence: Object.freeze([]),
          rationale: requirementCoverageRationales.explicitGap,
        });
      }
      const match = findRequirementCoverage(requirement, artifact);
      return Object.freeze({
        requirementId: requirement.id,
        status: match.covered ? "covered" : "uncovered",
        basis: match.basis,
        evidence: Object.freeze(
          match.blockIndexes.flatMap((index) => {
            const block = blocks[index];
            return block === undefined ? [] : [Object.freeze({ blockId: block.id })];
          }),
        ),
        rationale: rationaleFor(match),
      });
    }),
  );
}
