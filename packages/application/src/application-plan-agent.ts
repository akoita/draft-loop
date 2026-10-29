import type { ContextSnapshot } from "@draft-loop/domain";
import type { ApplicationPlanner, ApplicationPlanRequest } from "@draft-loop/orchestrator";
import {
  type JsonObject,
  type ModelRequest,
  type ModelResponse,
  ProviderAdapterError,
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
import { authorPromptSupportsApplicationPlan } from "./author-adjudication.js";
import { createAuthorEvidenceAliases } from "./author-evidence-aliases.js";
import {
  authorRunOutputSchemas,
  authorRunPrefix,
  runStableInputMembers,
} from "./author-run-prefix.js";
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

function invalidPlan(response: ModelResponse<JsonObject>, message: string): ProviderAdapterError {
  return new ProviderAdapterError(response.provider, "invalid-response", message, {
    retryable: true,
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
    const aliases = createAuthorEvidenceAliases(retrievedEvidence.map(({ id }) => id));
    const adapter = await deps.createAdapter(identity.company, identity.modelId, role);
    const model = request.context.modelConfiguration[role];
    const callInput = { runId: request.runId, executionId: request.executionId, ...extraInput };
    const toModel = (input: object) =>
      aliases.toModel(JSON.parse(JSON.stringify(input)) as JsonObject);
    const prefix =
      role === "author"
        ? authorRunPrefix(request.context, deps.promptContext, retrievedEvidence)
        : undefined;
    const modelRequest: ModelRequest<JsonObject> = {
      contextSnapshotId: request.context.id,
      model,
      // The author's plan calls lead with the drafting calls' run prefix and put their own
      // instructions after it, so every author call of the run shares one cached prefix.
      ...(prefix === undefined
        ? {
            systemPrompt,
            input: toModel({ context: deps.promptContext, retrievedEvidence, ...callInput }),
          }
        : {
            systemPrompt: `${prefix.systemPrompt}\n\n${systemPrompt}`,
            promptCache: {
              systemPrompt: prefix.systemPrompt,
              callInstructions: systemPrompt,
              stableInputMembers: runStableInputMembers,
              outputSchemas: authorRunOutputSchemas(request.context, aliases.aliases),
            },
            input: toModel({ ...prefix.input, ...callInput }),
          }),
      outputSchema: outputSchema(aliases.aliases),
      outputName,
      maxOutputTokens: model.profile?.runtime.maxOutputTokens ?? planOutputTokens,
      dataPolicy: deps.dataPolicy(identity.company),
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    };
    const response = await adapter.execute(modelRequest);
    return { response, output: aliases.fromModel(response.output), retrievedEvidence };
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

  const parsePlan = (
    response: ModelResponse<JsonObject>,
    output: JsonObject,
    request: ApplicationPlanRequest,
  ): ApplicationPlan => {
    const parsed = applicationPlanSchema.safeParse(output);
    if (!parsed.success) throw invalidPlan(response, "The author returned an invalid plan.");
    if (validateApplicationPlan(parsed.data, references(request)).length > 0) {
      throw invalidPlan(
        response,
        "The author returned a plan that cites unknown or unsupported items.",
      );
    }
    return parsed.data;
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
      const parsed = applicationPlanReviewSchema.safeParse(output);
      if (!parsed.success || validateApplicationPlanReview(parsed.data, request.plan).length > 0) {
        throw invalidPlan(response, "The critic returned an invalid plan review.");
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
      return responseExecution(response, parsePlan(response, output, request));
    },
    ...(deps.record === undefined ? {} : { record: deps.record }),
  };
}
