import type { ContextSnapshot } from "@draft-loop/domain";
import type { AuthorAgent } from "@draft-loop/orchestrator";
import type { JsonObject, ModelRequest, ModelResponse } from "@draft-loop/providers";
import { authorArtifactProposalJsonSchemaForEvidence } from "@draft-loop/schemas";

import { createAuthorAdjudicationPrompt } from "./author-adjudication.js";
import { proposalIssues } from "./author-diagnostic-counts.js";
import { createAuthorGroundingGuide } from "./author-grounding.js";
import {
  authorRevisionKey,
  forgetAuthorRevision,
  rememberAuthorRevision,
  takeAuthorRevision,
} from "./author-revision-memory.js";
import { authorRevisionProposal, buildAuthorRevisionReport } from "./author-revision-report.js";
import { buildAuthorArtifactWithCapture } from "./rejected-author-capture.js";
import { createRequirementAchievementPlan } from "./requirement-achievement-plan.js";
import { responseExecution } from "./response-execution.js";

export interface ProviderAuthorAgentDependencies {
  readonly context: ContextSnapshot;
  /** The context with local-only selection and lineage removed. */
  readonly promptContext: ContextSnapshot;
  readonly dataPolicy: (company: string) => ModelRequest<JsonObject>["dataPolicy"];
  readonly createAdapter: (
    company: string,
    modelId: string,
    role: "author",
  ) => Promise<{
    readonly execute: (request: ModelRequest<JsonObject>) => Promise<ModelResponse<JsonObject>>;
  }>;
  readonly authorCompany: string;
  readonly authorModel: string;
  readonly authorProposalCaptureDirectory: string | undefined;
  /** Build the user-facing error raised when no candidate evidence was retrieved. */
  readonly userError: (message: string) => Error;
}

/**
 * The provider-backed author agent.
 *
 * After a local validation rejection it remembers the rejected proposal and a
 * specific report in process memory; the next retry for the same run and
 * round sends both so the author revises instead of regenerating. Nothing
 * from that memory is persisted or placed in retry feedback.
 */
export function createProviderAuthorAgent(deps: ProviderAuthorAgentDependencies): AuthorAgent {
  const { context } = deps;
  return {
    execute: async ({
      executionId,
      runId,
      round,
      currentArtifact,
      findings,
      pendingAdjudication,
      retryFeedback,
      retrievedEvidence = [],
      signal,
    }) => {
      const achievementPlan = createRequirementAchievementPlan(
        context.requirements,
        retrievedEvidence,
      );
      if (achievementPlan.status === "no-evidence") {
        throw deps.userError("Drafting requires retrieved candidate evidence.");
      }
      const revisionKey = authorRevisionKey(runId, round);
      const revision = retryFeedback === undefined ? undefined : takeAuthorRevision(revisionKey);
      const authorPrompt = createAuthorAdjudicationPrompt(
        context.modelConfiguration.author.promptTemplateVersion,
        pendingAdjudication,
        retryFeedback,
        createAuthorGroundingGuide(retrievedEvidence),
        revision,
      );
      const request: ModelRequest<JsonObject> = {
        contextSnapshotId: context.id,
        model: context.modelConfiguration.author,
        systemPrompt: authorPrompt.systemPrompt,
        input: JSON.parse(
          JSON.stringify({
            executionId,
            runId,
            round,
            context: deps.promptContext,
            retrievedEvidence,
            achievementPlan,
            currentArtifact,
            findings,
            ...authorPrompt.providerInput,
          }),
        ) as JsonObject,
        outputSchema: authorArtifactProposalJsonSchemaForEvidence(
          retrievedEvidence.map(({ id }) => id),
        ) as JsonObject,
        outputName: "author_artifact_proposal",
        maxOutputTokens: authorPrompt.providerInput.outputBudget.maxOutputTokens,
        dataPolicy: deps.dataPolicy(deps.authorCompany),
        ...(signal === undefined ? {} : { signal }),
      };
      const adapter = await deps.createAdapter(deps.authorCompany, deps.authorModel, "author");
      const response = await adapter.execute(request);
      const artifact = await buildAuthorArtifactWithCapture(
        response,
        {
          executionId,
          context,
          currentArtifact,
          retrievedEvidence,
          requiredSections: context.outputConstraints.requiredSections,
        },
        deps.authorProposalCaptureDirectory,
        (validationInputs, error) =>
          rememberAuthorRevision(revisionKey, {
            rejectedProposal: authorRevisionProposal(validationInputs),
            report: buildAuthorRevisionReport(validationInputs, proposalIssues(error)),
          }),
      );
      forgetAuthorRevision(revisionKey);
      return responseExecution(response, artifact);
    },
  };
}
