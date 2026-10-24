import type { ContextSnapshot, ScoredEvidenceChunk } from "@draft-loop/domain";
import type { JsonObject } from "@draft-loop/providers";
import {
  authorArtifactProposalJsonSchemaForEvidence,
  authorRevisionPatchJsonSchemaForEvidence,
} from "@draft-loop/schemas";
import {
  applicationPlanJsonSchema,
  applicationPlanJsonSchemaForReferences,
} from "@draft-loop/schemas/application-plan";

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

/**
 * Every output an author call of the run asks for, by output name, for the run's evidence
 * aliases. All author calls send the whole set, so a provider whose prompt cache keys on the
 * output format can give them one format and keep the run prefix cached across them.
 */
export function authorRunOutputSchemas(
  context: Pick<ContextSnapshot, "requirements">,
  evidenceAliases: readonly string[],
): Readonly<Record<string, JsonObject>> {
  return {
    application_plan: applicationPlanJsonSchemaForReferences(applicationPlanJsonSchema, {
      evidenceChunkIds: evidenceAliases,
      requirementIds: context.requirements.map(({ id }) => id),
    }) as JsonObject,
    author_artifact_proposal: authorArtifactProposalJsonSchemaForEvidence(
      evidenceAliases,
    ) as JsonObject,
    author_revision_patch: authorRevisionPatchJsonSchemaForEvidence(evidenceAliases) as JsonObject,
  };
}
