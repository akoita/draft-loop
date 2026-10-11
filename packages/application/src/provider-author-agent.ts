import type { ContextSnapshot } from "@draft-loop/domain";
import type { AuthorAgent } from "@draft-loop/orchestrator";
import type { JsonObject, ModelRequest, ModelResponse } from "@draft-loop/providers";
import { authorArtifactProposalJsonSchemaForEvidence } from "@draft-loop/schemas";

import { createAuthorAdjudicationPrompt } from "./author-adjudication.js";
import { proposalIssues } from "./author-diagnostic-counts.js";
import { createAuthorEvidenceAliases } from "./author-evidence-aliases.js";
import { ungroundedAuthorContentFindings } from "./author-grounded-filter.js";
import { createAuthorGroundingGuide } from "./author-grounding.js";
import {
  authorRevisionKey,
  forgetAuthorRevision,
  rememberAuthorRevision,
  takeAuthorRevision,
} from "./author-revision-memory.js";
import { authorRevisionProposal, buildAuthorRevisionReport } from "./author-revision-report.js";
import {
  evidenceReferenceTableInstructions,
  modelFacingArtifactWithEvidenceTable,
} from "./provider-artifact-input.js";
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
 * from that memory is persisted or placed in retry feedback. A proposal whose
 * grounding failures are confined to blocks is not rejected: the draft keeps
 * the grounded blocks and carries a warning finding with the counts.
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
        context.modelConfiguration.author.profile?.runtime.maxOutputTokens,
      );
      const { outputBudget, groundingGuide, ...turnInput } = authorPrompt.providerInput;
      const evidenceAliases = createAuthorEvidenceAliases(retrievedEvidence.map(({ id }) => id));
      const request: ModelRequest<JsonObject> = {
        contextSnapshotId: context.id,
        model: context.modelConfiguration.author,
        systemPrompt: `${authorPrompt.systemPrompt}\n\n${evidenceReferenceTableInstructions}`,
        // Members that stay the same for every round of a run come first, so a
        // provider's prompt-prefix cache can reuse them; per-call members follow.
        input: evidenceAliases.toModel(
          JSON.parse(
            JSON.stringify({
              context: deps.promptContext,
              retrievedEvidence,
              achievementPlan,
              groundingGuide,
              outputBudget,
              runId,
              round,
              executionId,
              currentArtifact:
                currentArtifact === null
                  ? null
                  : modelFacingArtifactWithEvidenceTable(currentArtifact, context),
              findings,
              ...turnInput,
            }),
          ) as JsonObject,
        ),
        outputSchema: authorArtifactProposalJsonSchemaForEvidence(
          evidenceAliases.aliases,
        ) as JsonObject,
        outputName: "author_artifact_proposal",
        maxOutputTokens: outputBudget.maxOutputTokens,
        dataPolicy: deps.dataPolicy(deps.authorCompany),
        ...(signal === undefined ? {} : { signal }),
      };
      const adapter = await deps.createAdapter(deps.authorCompany, deps.authorModel, "author");
      const modelResponse = await adapter.execute(request);
      const response = {
        ...modelResponse,
        output: evidenceAliases.fromModel(modelResponse.output),
      };
      const grounded = await buildAuthorArtifactWithCapture(
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
      const outputFindings = ungroundedAuthorContentFindings(grounded);
      return {
        ...responseExecution(response, grounded.artifact),
        ...(outputFindings.length === 0 ? {} : { outputFindings }),
      };
    },
  };
}
