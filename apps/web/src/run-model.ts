import type { ApiSchemas } from "./api-client.js";
import type { Brief } from "./brief-model.js";

export type Run = ApiSchemas["Run"];
type Application = ApiSchemas["Application"];

const activeStates = new Set(["collecting", "ingesting", "drafting", "reviewing", "revising"]);

/** Whether the worker is still moving the run, so the screen keeps reading it. */
export function shouldPoll(run: Run): boolean {
  return activeStates.has(run.state);
}

/** The application's newest run, which the screen follows. */
export function latestRunId(application: Application): string | undefined {
  return application.runs.reduce<Application["runs"][number] | undefined>(
    (latest, run) => (latest === undefined || run.startedAt > latest.startedAt ? run : latest),
    undefined,
  )?.id;
}

/** Why a run cannot start from the brief, or `undefined` when it can. */
export function startProblem(brief: Brief | undefined): string | undefined {
  if (brief === undefined) return "Review the job requirements first.";
  if (brief.status !== "reviewed") return "Mark the job brief reviewed before starting a run.";
  return undefined;
}

/** The start request, from the reviewed brief version. */
export function startRunBody(brief: Brief) {
  return { opportunityBrief: { briefId: brief.id, version: brief.version } };
}
