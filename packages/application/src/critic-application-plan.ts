import type { ApplicationPlan } from "@draft-loop/schemas/application-plan";

import { createCriticAdjudicationPrompt } from "./critic-adjudication.js";
import type { CriticCoverageJudgementParts } from "./critic-critique-contract.js";
import { emphasisThemeSourceInstructions, withPlanThemeSource } from "./critic-emphasis.js";

/** Whether the critic prompt version reviews emphasis, and so has a theme source to replace. */
function reviewsEmphasis(criticPromptTemplateVersion: string): boolean {
  try {
    return createCriticAdjudicationPrompt(criticPromptTemplateVersion).includes(
      emphasisThemeSourceInstructions,
    );
  } catch {
    return false;
  }
}

/**
 * Give the critic the run's reviewed application plan as the theme source of its emphasis review
 * (#1304). Only a critic prompt version that carries the emphasis review (`cli-critic-v5` and later) is
 * given the plan; every other version, and a run without a plan, is returned untouched.
 */
export function withApplicationPlan(
  parts: CriticCoverageJudgementParts,
  plan: ApplicationPlan | undefined,
  criticPromptTemplateVersion: string,
): CriticCoverageJudgementParts {
  if (plan === undefined || !reviewsEmphasis(criticPromptTemplateVersion)) return parts;
  return {
    ...parts,
    systemPrompt: (prompt) => withPlanThemeSource(parts.systemPrompt(prompt)),
    input: { ...parts.input, applicationPlan: plan },
  };
}
