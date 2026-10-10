import { currentRoundCoverageJudgement } from "@draft-loop/application";
import type { RunSnapshot } from "@draft-loop/orchestrator";

import {
  maximumCoverageRequirementTextLength,
  type ReviewCoverageView,
} from "../coverage-contract.js";

/**
 * The review panel's coverage, from the same selection the CLI `status` uses: the latest
 * completed critic execution of the current round that carries a judgement.
 *
 * Scores and block text stay behind; the renderer receives ids, statuses, counts, the
 * user-visible rationale, and each requirement's text when the run's context recorded it.
 */
export function reviewCoverage(
  snapshot: RunSnapshot,
  requirementTexts: ReadonlyMap<string, string> = new Map(),
): ReviewCoverageView | null {
  const judgement = currentRoundCoverageJudgement(snapshot);
  if (judgement === undefined) return null;
  return {
    instructionsVersion: judgement.instructionsVersion,
    summary: {
      judged: judgement.summary.judged,
      satisfied: judgement.summary.satisfied,
      notSatisfied: judgement.summary.notSatisfied,
      invalid: judgement.summary.invalid,
      unanswered: judgement.summary.unanswered,
    },
    assessments: judgement.assessments.map((assessment) => {
      // Control characters other than line breaks and tabs would fail the bridge's validation.
      const text = requirementTexts
        .get(assessment.requirementId)
        ?.split("")
        .map((character) =>
          character === "\n" || character === "\t" || (character >= " " && character !== "\u007f")
            ? character
            : " ",
        )
        .join("")
        .trim();
      return {
        requirementId: assessment.requirementId,
        ...(text === undefined || text === ""
          ? {}
          : { requirementText: text.slice(0, maximumCoverageRequirementTextLength) }),
        status: assessment.status,
        basis: assessment.basis,
        evidence: assessment.evidence.map((item) => ({ blockId: item.blockId })),
        rationale: assessment.rationale,
      };
    }),
  };
}
