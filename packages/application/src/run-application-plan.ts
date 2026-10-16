import { randomUUID } from "node:crypto";

import type { ApplicationPlanner, AuthorAgent, CriticAgent } from "@draft-loop/orchestrator";
import {
  type ApplicationPlan,
  type ApplicationPlanReview,
  type ApplicationPlanState,
  applicationPlanStateSchema,
  guidingApplicationPlan,
} from "@draft-loop/schemas/application-plan";
import type { JsonValue, SqliteStorage } from "@draft-loop/storage";

import {
  createProviderApplicationPlanner,
  type ProviderApplicationPlannerDependencies,
} from "./application-plan-agent.js";
import { CliUserError } from "./cli-user-error.js";
import type { RecordAuthorInput } from "./run-author-input.js";

export const applicationPlanEventType = "run.application-plan";

/** The application plan of a run as Run details shows it, read back from run history. */
export interface RunApplicationPlan {
  /** The plan the draft follows: the revision when the critic asked for one. */
  readonly plan: ApplicationPlan;
  /** The critic's review, or `null` while the plan step is still unfinished. */
  readonly review: ApplicationPlanReview | null;
  /** Whether the author revised the plan after the review. */
  readonly revised: boolean;
}

/** The agents a run's engine is given; the planner is absent when the run does not plan. */
export interface RunAgents {
  readonly author: AuthorAgent;
  readonly critic: CriticAgent;
  readonly planner?: ApplicationPlanner;
}

/** What a run records while it works: its author input and, when it plans, its application plan. */
export interface RunRecorders {
  readonly recordAuthorInput: RecordAuthorInput;
  /** Absent turns the plan step off for the run. */
  readonly recordApplicationPlan?: (runId: string, state: ApplicationPlanState) => Promise<void>;
}

/** The recorders of a run; planning is on unless the run options turn it off. */
export function runRecorders(
  storage: Pick<SqliteStorage, "appendAuditEvent">,
  workspaceId: string,
  recordAuthorInput: RecordAuthorInput,
  applicationPlan: boolean | undefined,
): RunRecorders {
  return {
    recordAuthorInput,
    ...(applicationPlan === false
      ? {}
      : {
          recordApplicationPlan: (runId: string, state: ApplicationPlanState) =>
            recordRunApplicationPlan(storage, workspaceId, runId, state),
        }),
  };
}

/** The plan step for a run's provider agents, or `undefined` when the run does not plan. */
export function recordedApplicationPlanner(
  recorders: RunRecorders | undefined,
  deps: Omit<ProviderApplicationPlannerDependencies, "record" | "userError">,
): ApplicationPlanner | undefined {
  if (recorders?.recordApplicationPlan === undefined) return undefined;
  return createProviderApplicationPlanner({
    ...deps,
    userError: (message) => new CliUserError(message),
    record: recorders.recordApplicationPlan,
  });
}

/** Append the `run.application-plan` audit event; each completed call of the plan step appends one. */
export async function recordRunApplicationPlan(
  storage: Pick<SqliteStorage, "appendAuditEvent">,
  workspaceId: string,
  runId: string,
  state: ApplicationPlanState,
): Promise<void> {
  await storage.appendAuditEvent({
    id: `application-plan:${runId}:${randomUUID()}`,
    workspaceId,
    eventType: applicationPlanEventType,
    entityType: "run",
    entityId: runId,
    payload: JSON.parse(JSON.stringify(state)) as JsonValue,
    createdAt: new Date().toISOString(),
  });
}

/** The recorded plan view, or `undefined` when the payload does not have the recorded shape. */
export function parseRunApplicationPlanPayload(payload: unknown): RunApplicationPlan | undefined {
  const parsed = applicationPlanStateSchema.safeParse(payload);
  if (!parsed.success) return undefined;
  return {
    plan: guidingApplicationPlan(parsed.data),
    review: parsed.data.review,
    revised: parsed.data.revisedPlan !== null,
  };
}
