import type { ContextSnapshot, ScoredEvidenceChunk } from "@draft-loop/domain";
import {
  type ApplicationPlan,
  type ApplicationPlanReview,
  type ApplicationPlanState,
  type ApplicationPlanStepName,
  type ApplicationPlanStepRecord,
  isApplicationPlanComplete,
} from "@draft-loop/schemas/application-plan";

import type { AgentExecution, RunSnapshot } from "./index.js";

/*
 * The application plan step (#1304) runs before the first draft: the author plans, the critic
 * reviews the plan, and the author revises it once when the critic asks. The step is bounded at
 * three provider calls, its cost is added to the run's cost, and each call is persisted so a run
 * resumes where it stopped. The plan is guidance for the author and the critic, never evidence.
 */

export interface ApplicationPlanRequest {
  readonly executionId: string;
  readonly runId: string;
  readonly context: ContextSnapshot;
  readonly retrievedEvidence?: readonly ScoredEvidenceChunk[];
  readonly signal?: AbortSignal;
}

/** Provider-independent port for the plan step; the application implements it with real models. */
export interface ApplicationPlanner {
  /** Whether a run with this context plans; runs on earlier author prompts do not. */
  readonly applies: (context: ContextSnapshot) => boolean;
  readonly plan: (request: ApplicationPlanRequest) => Promise<AgentExecution<ApplicationPlan>>;
  readonly review: (
    request: ApplicationPlanRequest & { readonly plan: ApplicationPlan },
  ) => Promise<AgentExecution<ApplicationPlanReview>>;
  readonly revise: (
    request: ApplicationPlanRequest & {
      readonly plan: ApplicationPlan;
      readonly review: ApplicationPlanReview;
    },
  ) => Promise<AgentExecution<ApplicationPlan>>;
  /** Keeps the plan in run history; a failure is dropped and never fails the run. */
  readonly record?: (runId: string, state: ApplicationPlanState) => Promise<void>;
}

/** Marks which role's model failed, so a failed review is not blamed on the author's model. */
export function planStepFailure(error: unknown, role: "author" | "critic"): unknown {
  if (typeof error === "object" && error !== null) {
    try {
      return Object.assign(error, { planStepRole: role });
    } catch {
      return error;
    }
  }
  return error;
}

/** The role whose model failed the plan step, when the failure says so. */
export function planStepFailureRole(error: unknown): "author" | "critic" | undefined {
  const role =
    typeof error === "object" && error !== null
      ? (error as { readonly planStepRole?: unknown }).planStepRole
      : undefined;
  return role === "author" || role === "critic" ? role : undefined;
}

/** Whether the run still has to plan before its first draft. */
export function needsApplicationPlan(
  snapshot: Pick<RunSnapshot, "currentStep" | "artifact" | "applicationPlan">,
): boolean {
  return (
    snapshot.currentStep === "author" &&
    snapshot.artifact === null &&
    !isApplicationPlanComplete(snapshot.applicationPlan)
  );
}

function stepRecord(
  step: ApplicationPlanStepName,
  execution: AgentExecution<unknown>,
): ApplicationPlanStepRecord {
  return {
    step,
    provider: execution.provider,
    modelId: execution.modelId,
    inputTokens: execution.inputTokens,
    outputTokens: execution.outputTokens,
    estimatedUsd: execution.estimatedUsd,
    completedAt: execution.completedAt,
  };
}

export interface ApplicationPlanProgress {
  readonly snapshot: RunSnapshot;
  /** Set when the run's budget ran out before the step finished; the plan so far is kept. */
  readonly exhausted?: string;
}

export interface AdvanceApplicationPlanInput {
  readonly planner: ApplicationPlanner;
  readonly snapshot: RunSnapshot;
  readonly context: ContextSnapshot;
  readonly retrievedEvidence?: readonly ScoredEvidenceChunk[];
  readonly signal?: AbortSignal;
  /** The reason the run's budget is spent, checked before each provider call. */
  readonly budgetReason: (snapshot: RunSnapshot) => string | undefined;
  /** Persists the snapshot after a completed call. */
  readonly persist: (snapshot: RunSnapshot, step: ApplicationPlanStepName) => Promise<RunSnapshot>;
}

/**
 * Run the remaining calls of the plan step: plan, review, and at most one revision. Calls already
 * recorded in the snapshot are not repeated, so a resumed run continues mid-plan. Each call's cost
 * is added to the run's cost.
 */
export async function advanceApplicationPlan(
  input: AdvanceApplicationPlanInput,
): Promise<ApplicationPlanProgress> {
  let snapshot = input.snapshot;
  const common = {
    runId: snapshot.runId,
    context: input.context,
    ...(input.retrievedEvidence === undefined
      ? {}
      : { retrievedEvidence: input.retrievedEvidence }),
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  };
  const executionId = (step: ApplicationPlanStepName): string => `${snapshot.runId}:plan:${step}`;
  const record = async (
    state: ApplicationPlanState,
    step: ApplicationPlanStepName,
    execution: AgentExecution<unknown>,
  ): Promise<void> => {
    snapshot = await input.persist(
      {
        ...snapshot,
        applicationPlan: state,
        totalCostUsd: snapshot.totalCostUsd + (execution.estimatedUsd ?? 0),
      },
      step,
    );
    try {
      await input.planner.record?.(snapshot.runId, state);
    } catch {
      // Run history is best-effort: the plan matters more than its record.
    }
  };
  const exhaustedBeforeCall = (): ApplicationPlanProgress | undefined => {
    const exhausted = input.budgetReason(snapshot);
    return exhausted === undefined ? undefined : { snapshot, exhausted };
  };

  let state = snapshot.applicationPlan ?? null;
  if (state === null) {
    const stopped = exhaustedBeforeCall();
    if (stopped !== undefined) return stopped;
    const execution = await input.planner.plan({ ...common, executionId: executionId("plan") });
    state = {
      schemaVersion: 1,
      plan: execution.output,
      review: null,
      revisedPlan: null,
      steps: [stepRecord("plan", execution)],
    };
    await record(state, "plan", execution);
  }
  if (state.review === null) {
    const stopped = exhaustedBeforeCall();
    if (stopped !== undefined) return stopped;
    let execution: AgentExecution<ApplicationPlanReview>;
    try {
      execution = await input.planner.review({
        ...common,
        executionId: executionId("review"),
        plan: state.plan,
      });
    } catch (error) {
      throw planStepFailure(error, "critic");
    }
    state = {
      ...state,
      review: execution.output,
      steps: [...state.steps, stepRecord("review", execution)],
    };
    await record(state, "review", execution);
  }
  const { review } = state;
  if (review !== null && review.verdict === "revise" && state.revisedPlan === null) {
    const stopped = exhaustedBeforeCall();
    if (stopped !== undefined) return stopped;
    const execution = await input.planner.revise({
      ...common,
      executionId: executionId("revision"),
      plan: state.plan,
      review,
    });
    state = {
      ...state,
      revisedPlan: execution.output,
      steps: [...state.steps, stepRecord("revision", execution)],
    };
    await record(state, "revision", execution);
  }
  return { snapshot };
}
