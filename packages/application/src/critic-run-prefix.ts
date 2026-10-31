import type { ContextSnapshot, ScoredEvidenceChunk } from "@draft-loop/domain";
import type { CandidateDirection } from "@draft-loop/orchestrator";
import type { JsonObject } from "@draft-loop/providers";
import { applicationPlanReviewJsonSchema } from "@draft-loop/schemas/application-plan";

import { candidateDirectionCriticInstructions } from "./candidate-direction.js";
import * as criticPrompt from "./critic-adjudication.js";
import { reviewsEmphasis } from "./critic-application-plan.js";
import { critiqueOutputSchemaWithCoverageJudgements } from "./critic-critique-contract.js";
import { withPlanThemeSource } from "./critic-emphasis.js";
import { createRequirementAchievementPlan } from "./requirement-achievement-plan.js";

/** The leading critic input members every critic call of a run repeats: context to achievement plan. */
export const criticStableInputMembers = 3;

/**
 * What every critic call of a run sends first: the run's critic instructions and the run-stable
 * input members. The plan review sends the same prefix as the critiques, so a provider's prompt
 * cache written by the plan review is read by every critique of the run instead of each paying
 * for the whole career source again (#1986). The round's own instructions (coverage judgement,
 * candidate direction) follow the prefix as call instructions, so a round that has them still
 * reads the cache.
 *
 * A run that plans gives its critic the plan as the theme source of the emphasis review, so the
 * prefix of such a run carries that variant of the prompt on every call, the plan review included.
 */
export function criticRunPrefix(
  context: ContextSnapshot,
  promptContext: ContextSnapshot,
  retrievedEvidence: readonly ScoredEvidenceChunk[],
  plans: boolean,
) {
  const version = context.modelConfiguration.critic.promptTemplateVersion;
  const basePrompt = criticPrompt.create(version);
  return {
    systemPrompt: plans && reviewsEmphasis(version) ? withPlanThemeSource(basePrompt) : basePrompt,
    input: {
      context: promptContext,
      retrievedEvidence,
      achievementPlan: createRequirementAchievementPlan(context.requirements, retrievedEvidence),
    },
  };
}

/**
 * The instructions only this critic call carries, after the cached prefix: the coverage
 * judgement when the round asks for one, and the candidate's direction when the round has one.
 */
export function criticCallInstructions(
  judgesCoverage: boolean,
  candidateDirection: CandidateDirection | undefined,
): string {
  return [
    judgesCoverage ? criticPrompt.coverageJudgementInstructions : "",
    candidateDirection === undefined ? "" : candidateDirectionCriticInstructions,
  ]
    .filter((part) => part !== "")
    .join("\n\n");
}

/**
 * Every output a critic call of the run asks for, by output name. All critic calls send the whole
 * set, so a provider whose prompt cache keys on the output format can give them one format and
 * keep the run prefix cached across the plan review and the critiques.
 */
export function criticRunOutputSchemas(): Readonly<Record<string, JsonObject>> {
  return {
    application_plan_review: applicationPlanReviewJsonSchema as JsonObject,
    draft_critique: critiqueOutputSchemaWithCoverageJudgements,
  };
}
