import type { ContextSnapshot, ScoredEvidenceChunk } from "@draft-loop/domain";

import { createAuthorAdjudicationPrompt } from "./author-adjudication.js";
import { createAuthorGroundingGuide } from "./author-grounding.js";
import { evidenceReferenceTableInstructions } from "./provider-artifact-input.js";
import { createRequirementAchievementPlan } from "./requirement-achievement-plan.js";

/** The leading author input members that every author call of a run repeats: context to output budget. */
export const runStableInputMembers = 5;

/**
 * What every author call of a run sends first: the run's author instructions and the run-stable
 * input members. The plan step's author calls send the same prefix as the drafting calls, so a
 * provider's prompt cache written by the first plan call is read by the plan revision and every
 * draft of the run instead of each paying for the whole career source again.
 */
export function authorRunPrefix(
  context: ContextSnapshot,
  promptContext: ContextSnapshot,
  retrievedEvidence: readonly ScoredEvidenceChunk[],
) {
  const groundingGuide = createAuthorGroundingGuide(retrievedEvidence);
  const { systemPrompt, providerInput } = createAuthorAdjudicationPrompt(
    context.modelConfiguration.author.promptTemplateVersion,
    undefined,
    undefined,
    groundingGuide,
    undefined,
    context.modelConfiguration.author.profile?.runtime.maxOutputTokens,
  );
  return {
    systemPrompt: `${systemPrompt}\n\n${evidenceReferenceTableInstructions}`,
    input: {
      context: promptContext,
      retrievedEvidence,
      achievementPlan: createRequirementAchievementPlan(context.requirements, retrievedEvidence),
      groundingGuide,
      outputBudget: providerInput.outputBudget,
    },
  };
}
