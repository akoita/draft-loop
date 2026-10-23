import type { ApiSchemas } from "./api-client.js";
import type { Brief } from "./brief-model.js";

export type Run = ApiSchemas["Run"];
type Application = ApiSchemas["Application"];

/** How often the screen reads an active run. */
export const runPollIntervalMs = 3_000;

const activeStates = new Set(["collecting", "ingesting", "drafting", "reviewing", "revising"]);

/** Whether the worker is still moving the run, so the screen keeps reading it. */
export function shouldPoll(run: Run): boolean {
  return activeStates.has(run.state);
}

const stateLabels: Readonly<Record<string, string>> = {
  collecting: "Collecting your material",
  ingesting: "Reading your sources",
  drafting: "Drafting",
  reviewing: "The critic is reviewing the draft",
  revising: "Revising the draft",
  "awaiting-approval": "Ready for your review",
  approved: "Approved",
  exported: "Exported",
  paused: "Paused",
  stopped: "Stopped",
  "budget-exhausted": "Stopped at its budget",
};

const stepLabels: Readonly<Record<NonNullable<Run["currentStep"]>, string>> = {
  author: "the author is writing",
  critic: "the critic is reviewing",
  revision: "the author is revising",
};

/** One line on where the run is, such as `Round 2: the critic is reviewing`. */
export function runStatus(run: Run): string {
  const label = stateLabels[run.state] ?? run.state;
  if (!shouldPoll(run) || run.currentStep === null) return label;
  return `Round ${run.round}: ${stepLabels[run.currentStep]}`;
}

/** When a model's usage limit made the run wait, and until when. */
export function usageLimitWait(run: Run, locale?: string): string | undefined {
  const resetsAt = run.lastError?.usageLimitResetsAt;
  if (resetsAt === null || resetsAt === undefined) return undefined;
  const time = new Date(resetsAt).toLocaleString(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  });
  return `A model's usage limit was reached. The run continues after ${time} UTC.`;
}

/** A content-free error the run stopped on, other than a usage-limit wait. */
export function runError(run: Run): string | undefined {
  if (run.lastError === null || run.lastError.usageLimitResetsAt !== null) return undefined;
  return run.lastError.retryable
    ? `The last step failed (${run.lastError.code}) and will be retried.`
    : `The run stopped on an error (${run.lastError.code}).`;
}

/** An amount in US dollars, as estimated from the model prices. */
export function formatUsd(amount: number): string {
  return `US$${amount.toFixed(amount < 1 ? 3 : 2)}`;
}

export interface RunControls {
  readonly pause: boolean;
  readonly resume: boolean;
  readonly stop: boolean;
}

/** Which controls the run's state allows; the API refuses the others with 409. */
export function runControls(run: Run): RunControls {
  const ended = ["approved", "exported", "stopped", "budget-exhausted"].includes(run.state);
  return { pause: shouldPoll(run), resume: run.state === "paused", stop: !ended };
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
  if (brief === undefined) return "Paste a job post in the Job brief step first.";
  if (brief.status !== "reviewed") return "Mark the job brief reviewed before starting a run.";
  return undefined;
}

/** The start request, from the reviewed brief version. */
export function startRunBody(brief: Brief) {
  return { opportunityBrief: { briefId: brief.id, version: brief.version } };
}
