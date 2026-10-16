import type { ContextSnapshot } from "@draft-loop/domain";
import type { CriticAgent } from "@draft-loop/orchestrator";
import type { JsonObject, ModelRequest, ModelResponse } from "@draft-loop/providers";

import { withCandidateDirection } from "./candidate-direction.js";
import * as criticPrompt from "./critic-adjudication.js";
import { withApplicationPlan } from "./critic-application-plan.js";
import {
  criticCoverageJudgementParts,
  invalidCritiqueError,
  parseCritique,
} from "./critic-critique-contract.js";
import * as providerArtifactInput from "./provider-artifact-input.js";
import { createRequirementAchievementPlan } from "./requirement-achievement-plan.js";
import { responseExecution } from "./response-execution.js";
import { criticOutputBudget } from "./run-model-profiles.js";

export interface ProviderCriticAgentDependencies {
  readonly context: ContextSnapshot;
  /** The context with local-only selection and lineage removed. */
  readonly promptContext: ContextSnapshot;
  readonly dataPolicy: (company: string) => ModelRequest<JsonObject>["dataPolicy"];
  readonly createAdapter: (
    company: string,
    modelId: string,
    role: "critic",
  ) => Promise<{
    readonly execute: (request: ModelRequest<JsonObject>) => Promise<ModelResponse<JsonObject>>;
  }>;
  readonly criticCompany: string;
  readonly criticModel: string;
  /** Build the user-facing error raised when no candidate evidence was retrieved. */
  readonly userError: (message: string) => Error;
}

/** The provider-backed critic: independent review of one draft against the retrieved evidence. */
export function createProviderCriticAgent(deps: ProviderCriticAgentDependencies): CriticAgent {
  const { context } = deps;
  const promptVersion = context.modelConfiguration.critic.promptTemplateVersion;
  return {
    execute: async ({
      executionId,
      runId,
      round,
      artifact,
      deterministicFindings,
      coverageJudgementRequests,
      candidateDirection,
      applicationPlan,
      retrievedEvidence = [],
      signal,
    }) => {
      const judgement = withApplicationPlan(
        withCandidateDirection(
          criticCoverageJudgementParts(coverageJudgementRequests, context, artifact),
          candidateDirection,
        ),
        applicationPlan,
        promptVersion,
      );
      const achievementPlan = createRequirementAchievementPlan(
        context.requirements,
        retrievedEvidence,
      );
      if (achievementPlan.status === "no-evidence") {
        throw deps.userError("Critique requires retrieved candidate evidence.");
      }
      const request: ModelRequest<JsonObject> = {
        contextSnapshotId: context.id,
        model: context.modelConfiguration.critic,
        systemPrompt: judgement.systemPrompt(criticPrompt.create(promptVersion)),
        input: JSON.parse(
          JSON.stringify({
            context: deps.promptContext,
            retrievedEvidence,
            achievementPlan,
            runId,
            round,
            executionId,
            artifact: providerArtifactInput.modelFacingArtifactWithEvidenceTable(artifact, context),
            deterministicFindings,
            ...judgement.input,
          }),
        ) as JsonObject,
        outputSchema: judgement.outputSchema,
        outputName: "draft_critique",
        maxOutputTokens: criticOutputBudget(context.modelConfiguration.critic),
        dataPolicy: deps.dataPolicy(deps.criticCompany),
        ...(signal === undefined ? {} : { signal }),
      };
      const adapter = await deps.createAdapter(deps.criticCompany, deps.criticModel, "critic");
      const response = await adapter.execute(request);
      try {
        return responseExecution(
          response,
          parseCritique(response.output, judgement.instructionsVersion),
        );
      } catch {
        throw invalidCritiqueError(response);
      }
    },
  };
}
