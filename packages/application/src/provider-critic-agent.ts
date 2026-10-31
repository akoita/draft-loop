import type { ContextSnapshot } from "@draft-loop/domain";
import type { CriticAgent } from "@draft-loop/orchestrator";
import type { JsonObject, ModelRequest, ModelResponse } from "@draft-loop/providers";

import { guardCallCost } from "./call-cost-guard.js";
import { withCandidateDirection } from "./candidate-direction.js";
import * as criticPrompt from "./critic-adjudication.js";
import { withApplicationPlan } from "./critic-application-plan.js";
import {
  criticCoverageJudgementParts,
  critiqueOutputSchemaWithCoverageJudgements,
  invalidCritiqueError,
  parseCritique,
} from "./critic-critique-contract.js";
import {
  criticCallInstructions,
  criticRunOutputSchemas,
  criticRunPrefix,
  criticStableInputMembers,
} from "./critic-run-prefix.js";
import * as providerArtifactInput from "./provider-artifact-input.js";
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
      remainingCostUsd,
      signal,
    }) => {
      const judgementFor = (requests: typeof coverageJudgementRequests) =>
        withApplicationPlan(
          withCandidateDirection(
            criticCoverageJudgementParts(requests, context, artifact),
            candidateDirection,
          ),
          applicationPlan,
          promptVersion,
        );
      const judgement = judgementFor(coverageJudgementRequests);
      const judgesCoverage = judgement.instructionsVersion !== undefined;
      const basePrompt = criticPrompt.create(promptVersion);
      const prefix = criticRunPrefix(
        context,
        deps.promptContext,
        retrievedEvidence,
        applicationPlan !== undefined,
      );
      if (prefix.input.achievementPlan.status === "no-evidence") {
        throw deps.userError("Critique requires retrieved candidate evidence.");
      }
      const request: ModelRequest<JsonObject> = {
        contextSnapshotId: context.id,
        model: context.modelConfiguration.critic,
        systemPrompt: judgement.systemPrompt(basePrompt),
        // Every critic call of a run, the plan review included, sends the same instructions,
        // output format and leading input, so a provider's prompt cache written by the first call
        // is read by the later ones. Coverage-judgement and candidate-direction instructions vary
        // by round, so they follow the cached prefix (#1986).
        promptCache: {
          systemPrompt: prefix.systemPrompt,
          callInstructions: criticCallInstructions(judgesCoverage, candidateDirection),
          stableInputMembers: criticStableInputMembers,
          outputSchemas: criticRunOutputSchemas(),
        },
        input: JSON.parse(
          JSON.stringify({
            ...prefix.input,
            runId,
            round,
            executionId,
            artifact: criticPrompt.criticReadsCompactEvidenceTable(promptVersion)
              ? providerArtifactInput.modelFacingArtifactWithCompactEvidenceTable(
                  artifact,
                  context,
                  retrievedEvidence,
                )
              : providerArtifactInput.modelFacingArtifactWithEvidenceTable(artifact, context),
            deterministicFindings,
            ...judgement.input,
          }),
        ) as JsonObject,
        outputSchema: critiqueOutputSchemaWithCoverageJudgements,
        outputName: "draft_critique",
        maxOutputTokens: criticOutputBudget(context.modelConfiguration.critic),
        dataPolicy: deps.dataPolicy(deps.criticCompany),
        ...(signal === undefined ? {} : { signal }),
      };
      const adapter = guardCallCost(
        await deps.createAdapter(deps.criticCompany, deps.criticModel, "critic"),
        remainingCostUsd,
      );
      const response = await adapter.execute(request);
      try {
        // A critique that judged no coverage still returns the shared format's empty list.
        const { coverageJudgements: _unrequested, ...findingsOnly } = response.output;
        const output = judgesCoverage ? response.output : findingsOnly;
        return responseExecution(response, parseCritique(output, judgement.instructionsVersion));
      } catch {
        throw invalidCritiqueError(response);
      }
    },
  };
}
