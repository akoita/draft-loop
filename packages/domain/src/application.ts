/**
 * A job application inside a workspace (ADR 0010). The workspace is the candidate's home; each
 * application holds one job source with its briefs, runs and exports.
 */
export const applicationStatuses = [
  "collecting",
  "drafting",
  "in-review",
  "approved",
  "exported",
] as const;
export type ApplicationStatus = (typeof applicationStatuses)[number];

/** Reserved id of the application a legacy workspace is read as, built from its `job.md`. */
export const defaultApplicationId = "default";

export const applicationNameMaxLength = 120;

export const applicationJobSourceKinds = ["pasted-text", "approved-url", "local-file"] as const;
export type ApplicationJobSourceKind = (typeof applicationJobSourceKinds)[number];

/** Trimmed display name of 1 to 120 characters, such as a company and role. */
export function normalizeApplicationName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > applicationNameMaxLength) {
    throw new RangeError(
      `Application name must be between 1 and ${applicationNameMaxLength} characters.`,
    );
  }
  return trimmed;
}

/** A run state in which the candidate has nothing to review yet. */
const draftingRunStates: ReadonlySet<string> = new Set(["collecting", "ingesting", "drafting"]);

/**
 * Derives the status from what the application already holds, so it is never stored twice.
 *
 * - `exported`: an export completed, or a run reached the exported state.
 * - `approved`: a run was approved.
 * - `in-review`: a run has a draft past drafting, including paused, stopped or budget-exhausted.
 * - `drafting`: every run is still collecting, ingesting or drafting.
 * - `collecting`: no run yet, so the candidate is still collecting the job and profile inputs,
 *   as the application's page says.
 */
export function deriveApplicationStatus(
  runs: readonly { readonly state: string }[],
  hasCompletedExport: boolean,
): ApplicationStatus {
  if (hasCompletedExport || runs.some((run) => run.state === "exported")) return "exported";
  if (runs.some((run) => run.state === "approved")) return "approved";
  if (runs.some((run) => !draftingRunStates.has(run.state))) return "in-review";
  return runs.length === 0 ? "collecting" : "drafting";
}

/**
 * Whether a run ended before an approval: it stopped or ran out of budget, so the candidate starts
 * a new review instead of resuming it.
 */
export function runEndedBeforeApproval(state: string): boolean {
  return state === "stopped" || state === "budget-exhausted";
}

/**
 * Where one application stands for the candidate, the stage every guidance surface names (#3223):
 * the screens, the agent channel and the support assistant read this one function.
 *
 * - `start-review`: no run yet.
 * - `drafting`: its review is writing the first draft.
 * - `reviewing`: a draft waits for the candidate's decisions and approval.
 * - `review-ended`: its newest run stopped or ran out of budget before an approval.
 * - `export`: approved and not downloaded yet.
 * - `done`: downloaded.
 */
export const applicationStages = [
  "start-review",
  "drafting",
  "reviewing",
  "review-ended",
  "export",
  "done",
] as const;
export type ApplicationStage = (typeof applicationStages)[number];

export function applicationStage(application: {
  readonly status: ApplicationStatus;
  readonly runCount: number;
  readonly exportCount: number;
  /** Whether the newest run ended before an approval (see `runEndedBeforeApproval`). */
  readonly newestRunEnded: boolean;
}): ApplicationStage {
  if (application.status === "exported" || application.exportCount > 0) return "done";
  if (application.status === "approved") return "export";
  if (application.runCount === 0) return "start-review";
  if (application.newestRunEnded) return "review-ended";
  return application.status === "in-review" ? "reviewing" : "drafting";
}
