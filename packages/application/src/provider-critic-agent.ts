import type { ContextSnapshot } from "@draft-loop/domain";
import {
  type AgentExecution,
  CallCostBudgetError,
  type CriticAgent,
  type Critique,
} from "@draft-loop/orchestrator";
import {
  addBilledUsage,
  type BilledUsage,
  type JsonObject,
  type ModelRequest,
  type ModelResponse,
} from "@draft-loop/providers";

import { guardCallCost } from "./call-cost-guard.js";
import { withCandidateDirection } from "./candidate-direction.js";
import * as criticPrompt from "./critic-adjudication.js";
import { withApplicationPlan } from "./critic-application-plan.js";
import {
  criticCoverageJudgementParts,
  critiqueOutputSchemaFor,
  invalidCritiqueError,
  parseCritique,
  withResolvableFindingTargets,
} from "./critic-critique-contract.js";
import { capBlockingOmissions, isOmissionFindingCode } from "./critic-omission.js";
import {
  blockingOmissionCheckFindings,
  mergeOmissionChecks,
  type OmissionCheckOmission,
  omissionCheckFindings,
  omissionCheckInputs,
  omissionCheckOutputSchema,
  omissionCheckScope,
  omissionCheckSystemPrompt,
  parseOmissionCheck,
} from "./critic-omission-check.js";
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
          outputSchemas: criticRunOutputSchemas(promptVersion),
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
        outputSchema: critiqueOutputSchemaFor(promptVersion),
        outputName: "draft_critique",
        maxOutputTokens: criticOutputBudget(context.modelConfiguration.critic),
        dataPolicy: deps.dataPolicy(deps.criticCompany),
        ...(signal === undefined ? {} : { signal }),
      };
      const adapter = guardCallCost(
        await deps.createAdapter(deps.criticCompany, deps.criticModel, "critic"),
        remainingCostUsd,
      );
      // The omission check (#2039) goes first: it is the cheap call, and the guard counts what it
      // spent before pricing the critique. When the critique is then refused, the error carries
      // the check's bill so the run's record still counts it. The check carries the critic's own
      // output budget: a provider adapter refuses a request whose budget differs from the
      // selected profile's, which is how the 2026-11-01 r10 run of reference G lost its
      // critique before the check was sent (#2044). A v10 run makes one call per slice of the
      // retrieved evidence (#2046); a refusal mid-way carries what the earlier slices billed.
      const scope = omissionCheckScope(promptVersion);
      const slices =
        scope === undefined
          ? []
          : omissionCheckInputs(
              artifact,
              retrievedEvidence,
              applicationPlan,
              context.requirements,
              prefix.input.achievementPlan,
              scope,
            );
      let billed: BilledUsage | undefined;
      const withBill = (error: unknown) => {
        if (error instanceof CallCostBudgetError && billed !== undefined) {
          Object.assign(error, { billed });
        }
        return error;
      };
      const checked: (readonly OmissionCheckOmission[])[] = [];
      for (const slice of slices) {
        let checkResponse: ModelResponse<JsonObject>;
        try {
          checkResponse = await adapter.execute({
            contextSnapshotId: context.id,
            model: context.modelConfiguration.critic,
            systemPrompt: omissionCheckSystemPrompt,
            input: JSON.parse(JSON.stringify(slice)) as JsonObject,
            outputSchema: omissionCheckOutputSchema,
            outputName: "omission_check",
            maxOutputTokens: criticOutputBudget(context.modelConfiguration.critic),
            dataPolicy: deps.dataPolicy(deps.criticCompany),
            ...(signal === undefined ? {} : { signal }),
          });
        } catch (error) {
          throw withBill(error);
        }
        billed = addBilledUsage(billed, {
          usage: checkResponse.usage,
          cost: checkResponse.cost,
        });
        checked.push(parseOmissionCheck(checkResponse.output, slice));
      }
      let response: ModelResponse<JsonObject>;
      try {
        response = await adapter.execute(request);
      } catch (error) {
        throw withBill(error);
      }
      let critique: Critique;
      try {
        // A critique that judged no coverage still returns the shared format's empty list.
        const { coverageJudgements: _unrequested, ...findingsOnly } = response.output;
        const output = judgesCoverage ? response.output : findingsOnly;
        critique = withResolvableFindingTargets(
          parseCritique(output, judgement.instructionsVersion),
          artifact,
          context,
        );
      } catch {
        throw invalidCritiqueError(response);
      }
      const first = slices[0];
      if (first === undefined || billed === undefined) {
        return responseExecution(response, critique);
      }
      // The check owns the omission review of a run that makes it: its findings replace any the
      // critique still reports with that code, and the blocking cap applies to the merged list.
      const omissions = omissionCheckFindings(mergeOmissionChecks(checked), first.themes);
      const merged: Critique = {
        ...critique,
        findings: capBlockingOmissions(
          [...critique.findings.filter(({ code }) => !isOmissionFindingCode(code)), ...omissions],
          blockingOmissionCheckFindings(promptVersion),
        ),
      };
      return withBilledCall(responseExecution(response, merged), billed);
    },
  };
}

const sumCounts = (left: number | undefined, right: number | undefined) =>
  left === undefined && right === undefined ? undefined : (left ?? 0) + (right ?? 0);

/** Add the check calls' tokens and cost to an execution, so the record carries every call. */
function withBilledCall<T>(
  execution: AgentExecution<T>,
  call: Pick<ModelResponse<JsonObject>, "usage" | "cost">,
): AgentExecution<T> {
  const cached = sumCounts(execution.cachedInputTokens, call.usage.cachedInputTokens);
  const written = sumCounts(execution.cacheWriteInputTokens, call.usage.cacheWriteInputTokens);
  return {
    ...execution,
    inputTokens: execution.inputTokens + call.usage.inputTokens,
    outputTokens: execution.outputTokens + call.usage.outputTokens,
    totalTokens: execution.totalTokens + call.usage.totalTokens,
    ...(cached === undefined ? {} : { cachedInputTokens: cached }),
    ...(written === undefined ? {} : { cacheWriteInputTokens: written }),
    estimatedUsd:
      execution.estimatedUsd === null || call.cost.estimatedUsd === null
        ? null
        : execution.estimatedUsd + call.cost.estimatedUsd,
  };
}
