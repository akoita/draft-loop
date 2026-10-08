/**
 * A job application inside a workspace (ADR 0010). The workspace is the candidate's home; each
 * application holds one job source with its briefs, runs and exports.
 */
export const applicationStatuses = ["drafting", "in-review", "approved", "exported"] as const;
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
 * - `drafting`: no run yet, or every run is still collecting, ingesting or drafting.
 */
export function deriveApplicationStatus(
  runs: readonly { readonly state: string }[],
  hasCompletedExport: boolean,
): ApplicationStatus {
  if (hasCompletedExport || runs.some((run) => run.state === "exported")) return "exported";
  if (runs.some((run) => run.state === "approved")) return "approved";
  if (runs.some((run) => !draftingRunStates.has(run.state))) return "in-review";
  return "drafting";
}
