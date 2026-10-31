import type { ContextSnapshot } from "@draft-loop/domain";
import type { ApplicationPlanner, ApplicationPlanRequest } from "@draft-loop/orchestrator";
import {
  type JsonObject,
  type ModelRequest,
  type ModelResponse,
  ProviderAdapterError,
  type ProviderValidationDiagnostic,
} from "@draft-loop/providers";
import {
  type ApplicationPlan,
  type ApplicationPlanReview,
  type ApplicationPlanState,
  applicationPlanJsonSchema,
  applicationPlanJsonSchemaForReferences,
  applicationPlanReviewJsonSchema,
  applicationPlanReviewSchema,
  applicationPlanSchema,
  validateApplicationPlan,
  validateApplicationPlanReview,
} from "@draft-loop/schemas/application-plan";

import {
  applicationPlanReviewSystemPrompt,
  applicationPlanRevisionSystemPrompt,
  applicationPlanSystemPrompt,
} from "./application-plan-prompts.js";
import {
  normalizeApplicationPlanReviewOutput,
  planReviewDiagnostics,
} from "./application-plan-review-output.js";
import { authorPromptSupportsApplicationPlan } from "./author-adjudication.js";
import { createAuthorEvidenceAliases } from "./author-evidence-aliases.js";
import {
  authorRunOutputSchemas,
  authorRunPrefix,
  runStableInputMembers,
} from "./author-run-prefix.js";
import { guardCallCost } from "./call-cost-guard.js";
import {
  criticRunOutputSchemas,
  criticRunPrefix,
  criticStableInputMembers,
} from "./critic-run-prefix.js";
import { responseExecution } from "./response-execution.js";

/**
 * The plan is a short decision; this cap keeps the whole step cheap and bounded. A selected model
 * profile fixes the request budget instead, since profile-aware adapters reject any other value.
 */
const planOutputTokens = 4_096;

export interface ProviderApplicationPlannerDependencies {
  readonly promptContext: ContextSnapshot;
  readonly dataPolicy: (company: string) => ModelRequest<JsonObject>["dataPolicy"];
  readonly createAdapter: (
    company: string,
    modelId: string,
    role: "author" | "critic",
  ) => Promise<{
    readonly execute: (request: ModelRequest<JsonObject>) => Promise<ModelResponse<JsonObject>>;
  }>;
  readonly author: { readonly company: string; readonly modelId: string };
  readonly critic: { readonly company: string; readonly modelId: string };
  /** Build the user-facing error raised when no candidate evidence was retrieved. */
  readonly userError: (message: string) => Error;
  /** Keeps the plan in run history; a failure is dropped and never fails the run. */
  readonly record?: (runId: string, state: ApplicationPlanState) => Promise<void>;
}

/** Whether runs recorded on this author prompt version plan; unknown versions do not. */
export function runPlansApplication(context: Pick<ContextSnapshot, "modelConfiguration">): boolean {
  try {
    return authorPromptSupportsApplicationPlan(
      context.modelConfiguration.author.promptTemplateVersion,
    );
  } catch {
    return false;
  }
}

function invalidPlan(
  response: ModelResponse<JsonObject>,
  message: string,
  diagnostics: readonly ProviderValidationDiagnostic[] = [],
): ProviderAdapterError {
  return new ProviderAdapterError(response.provider, "invalid-response", message, {
    retryable: true,
    ...(diagnostics.length === 0 ? {} : { diagnostics }),
    ...(response.providerRequestId === null ? {} : { requestId: response.providerRequestId }),
    // The provider billed the response even though it is rejected here (#1967).
    billed: { usage: response.usage, cost: response.cost },
  });
}

/**
 * The provider-backed plan step: the author model plans and revises, the critic model reviews.
 * Evidence is sent under short aliases and mapped back, and a plan that cites an id the request
 * does not hold, or that leads with a gap, is rejected as an invalid response.
 */
export function createProviderApplicationPlanner(
  deps: ProviderApplicationPlannerDependencies,
): ApplicationPlanner {
  const call = async (
    role: "author" | "critic",
    request: ApplicationPlanRequest,
    systemPrompt: string,
    extraInput: Record<string, unknown>,
    outputSchema: (aliases: readonly string[]) => JsonObject,
    outputName: string,
  ) => {
    const retrievedEvidence = request.retrievedEvidence ?? [];
    if (retrievedEvidence.length === 0) {
      throw deps.userError("Planning requires retrieved candidate evidence.");
    }
    const identity = role === "author" ? deps.author : deps.critic;
    const adapter = guardCallCost(
      await deps.createAdapter(identity.company, identity.modelId, role),
      request.remainingCostUsd,
    );
    const model = request.context.modelConfiguration[role];
    const callInput = { runId: request.runId, executionId: request.executionId, ...extraInput };
    // The author's plan calls lead with the drafting calls' run prefix and the critic's review
    // leads with the critiques' run prefix, each with its own instructions after it, so every
    // call of a role shares one cached prefix across the run. The author's calls send evidence
    // under short aliases and map them back; the critic's calls use the ids the critiques use,
    // so the review and the critiques share one cached prefix.
    const aliases =
      role === "author"
        ? createAuthorEvidenceAliases(retrievedEvidence.map(({ id }) => id))
        : undefined;
    const toModel = (input: object) => {
      const json = JSON.parse(JSON.stringify(input)) as JsonObject;
      return aliases === undefined ? json : aliases.toModel(json);
    };
    const prefix =
      role === "author"
        ? authorRunPrefix(request.context, deps.promptContext, retrievedEvidence)
        : criticRunPrefix(request.context, deps.promptContext, retrievedEvidence, true);
    const aliasNames = aliases?.aliases ?? [];
    const modelRequest: ModelRequest<JsonObject> = {
      contextSnapshotId: request.context.id,
      model,
      systemPrompt: `${prefix.systemPrompt}\n\n${systemPrompt}`,
      promptCache: {
        systemPrompt: prefix.systemPrompt,
        callInstructions: systemPrompt,
        stableInputMembers: role === "author" ? runStableInputMembers : criticStableInputMembers,
        outputSchemas:
          role === "author"
            ? authorRunOutputSchemas(request.context, aliasNames)
            : criticRunOutputSchemas(),
      },
      input: toModel({ ...prefix.input, ...callInput }),
      outputSchema: outputSchema(aliasNames),
      outputName,
      maxOutputTokens: model.profile?.runtime.maxOutputTokens ?? planOutputTokens,
      dataPolicy: deps.dataPolicy(identity.company),
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    };
    const response = await adapter.execute(modelRequest);
    return {
      response,
      output: aliases === undefined ? response.output : aliases.fromModel(response.output),
      retrievedEvidence,
    };
  };

  const references = (request: ApplicationPlanRequest) => ({
    evidenceChunkIds: (request.retrievedEvidence ?? []).map(({ id }) => id),
    requirementIds: request.context.requirements.map(({ id }) => id),
  });
  const planSchema = (request: ApplicationPlanRequest) => (aliases: readonly string[]) =>
    applicationPlanJsonSchemaForReferences(applicationPlanJsonSchema, {
      evidenceChunkIds: aliases,
      requirementIds: references(request).requirementIds,
    }) as JsonObject;

  /** The plan, or the content-free diagnostics of the checks it failed. */
  const checkPlan = (
    output: JsonObject,
    request: ApplicationPlanRequest,
  ):
    | { readonly plan: ApplicationPlan }
    | { readonly message: string; readonly diagnostics: ProviderValidationDiagnostic[] } => {
    const parsed = applicationPlanSchema.safeParse(output);
    if (!parsed.success) {
      return {
        message: "The author returned an invalid plan.",
        diagnostics: planReviewDiagnostics(parsed.error.issues),
      };
    }
    const issues = validateApplicationPlan(parsed.data, references(request));
    if (issues.length > 0) {
      return {
        message: "The author returned a plan that cites unknown or unsupported items.",
        diagnostics: issues.slice(0, 10).map(({ code, path }) => ({ code, path })),
      };
    }
    return { plan: parsed.data };
  };
  const parsePlan = (
    response: ModelResponse<JsonObject>,
    output: JsonObject,
    request: ApplicationPlanRequest,
  ): ApplicationPlan => {
    const checked = checkPlan(output, request);
    if ("plan" in checked) return checked.plan;
    throw invalidPlan(response, checked.message, checked.diagnostics);
  };

  return {
    applies: runPlansApplication,
    plan: async (request) => {
      const { response, output } = await call(
        "author",
        request,
        applicationPlanSystemPrompt,
        {},
        planSchema(request),
        "application_plan",
      );
      return responseExecution(response, parsePlan(response, output, request));
    },
    review: async (request) => {
      const { response, output } = await call(
        "critic",
        request,
        applicationPlanReviewSystemPrompt,
        { applicationPlan: request.plan },
        () => applicationPlanReviewJsonSchema as JsonObject,
        "application_plan_review",
      );
      const parsed = applicationPlanReviewSchema.safeParse(
        normalizeApplicationPlanReviewOutput(output, request.plan),
      );
      if (!parsed.success) {
        throw invalidPlan(
          response,
          "The critic returned an invalid plan review.",
          planReviewDiagnostics(parsed.error.issues),
        );
      }
      const issues = validateApplicationPlanReview(parsed.data, request.plan);
      if (issues.length > 0) {
        throw invalidPlan(
          response,
          "The critic returned an invalid plan review.",
          issues.map(({ code, path }) => ({ code, path })),
        );
      }
      return responseExecution<ApplicationPlanReview>(response, parsed.data);
    },
    revise: async (request) => {
      const { response, output } = await call(
        "author",
        request,
        applicationPlanRevisionSystemPrompt,
        { applicationPlan: request.plan, planReview: request.review },
        planSchema(request),
        "application_plan",
      );
      const checked = checkPlan(output, request);
      if ("plan" in checked) return responseExecution(response, checked.plan);
      // The plan is guidance: a revision that breaks its limits keeps the reviewed plan and
      // records which checks failed, instead of ending the run (r4, 2026-10-30).
      return {
        ...responseExecution(response, request.plan),
        rejectedDiagnostics: checked.diagnostics,
      };
    },
    ...(deps.record === undefined ? {} : { record: deps.record }),
  };
}
