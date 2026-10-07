import { currentRoundCoverageJudgement } from "@draft-loop/application";
import type { RunSnapshot } from "@draft-loop/orchestrator";

import type { ReviewCoverageView } from "../coverage-contract.js";

/**
 * The review panel's coverage, from the same selection the CLI `status` uses: the latest
 * completed critic execution of the current round that carries a judgement.
 *
 * Scores, requirement text, and block text stay behind; the renderer receives ids, statuses,
 * counts, and the user-visible rationale.
 */
export function reviewCoverage(snapshot: RunSnapshot): ReviewCoverageView | null {
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
    assessments: judgement.assessments.map((assessment) => ({
      requirementId: assessment.requirementId,
      status: assessment.status,
      basis: assessment.basis,
      evidence: assessment.evidence.map((item) => ({ blockId: item.blockId })),
      rationale: assessment.rationale,
    })),
  };
}
