import { blocksStart, jobDescriptionSteps, type StartCondition } from "./start-checklist-model.js";

/**
 * The application screen's three numbered steps and their states, derived from the same start
 * conditions the "Before you can start" checklist shows, so the steps and the checklist agree.
 */

export type ApplicationStepId = "job" | "profile" | "review";

export type ApplicationStepStatus =
  | { readonly kind: "done" }
  | { readonly kind: "current" }
  | { readonly kind: "blocked"; readonly reason: string };

export interface ApplicationStepState {
  readonly id: ApplicationStepId;
  readonly number: 1 | 2 | 3;
  readonly title: string;
  readonly status: ApplicationStepStatus;
}

/** DOM id of each step's list item. */
export const applicationStepIds: Readonly<Record<ApplicationStepId, string>> = {
  job: "application-step-job",
  profile: "application-step-profile",
  review: "application-step-review",
};

const titles: Readonly<Record<ApplicationStepId, string>> = {
  job: "Job & requirements",
  profile: "Profile",
  review: "Review",
};

function unmetDetail(condition: StartCondition): string {
  return condition.detail ?? condition.label;
}

/**
 * The job step is done once the requirements condition is met (a reviewed brief is selected, or
 * the job description is ready and the requirements are read from it) and no host step about the
 * job description is still open.
 */
function jobBlocker(conditions: readonly StartCondition[]): StartCondition | null {
  const requirements = conditions.find((condition) => condition.id === "requirements");
  if (requirements !== undefined && !requirements.done) return requirements;
  return (
    conditions.find(
      (condition) =>
        condition.id.startsWith("setup-") &&
        blocksStart(condition) &&
        jobDescriptionSteps.includes(condition.label),
    ) ?? null
  );
}

/** The profile step is done once a reviewed profile is selected, or when the host needs none. */
function profileBlocker(conditions: readonly StartCondition[]): StartCondition | null {
  const profile = conditions.find((condition) => condition.id === "profile");
  return profile === undefined || profile.done ? null : profile;
}

function stepsLabel(numbers: readonly number[]): string {
  return numbers.length === 1 ? `step ${numbers[0]}` : `steps ${numbers.join(" and ")}`;
}

/**
 * The state of each step, top to bottom. The first step that is not done is the current one; a
 * later step that is not done is blocked, with the reason it waits on. The review step is
 * current once the job and the profile steps are done; its own conditions are the checklist's.
 */
export function applicationStepStates(
  conditions: readonly StartCondition[],
): readonly ApplicationStepState[] {
  const job = jobBlocker(conditions);
  const profile = profileBlocker(conditions);
  const open: number[] = [];
  if (job !== null) open.push(1);
  if (profile !== null) open.push(2);
  const firstOpen = open[0] ?? 3;
  const status = (
    number: 1 | 2 | 3,
    blocker: StartCondition | null,
    blockedReason: () => string,
  ): ApplicationStepStatus => {
    if (number < 3 && blocker === null) return { kind: "done" };
    if (number === firstOpen) return { kind: "current" };
    return { kind: "blocked", reason: blockedReason() };
  };
  return [
    {
      id: "job",
      number: 1,
      title: titles.job,
      status: status(1, job, () => (job === null ? "" : unmetDetail(job))),
    },
    {
      id: "profile",
      number: 2,
      title: titles.profile,
      status: status(2, profile, () => (profile === null ? "" : unmetDetail(profile))),
    },
    {
      id: "review",
      number: 3,
      title: titles.review,
      status: status(3, null, () => `finish ${stepsLabel(open)} first.`),
    },
  ];
}

/** The status line under a step's heading. */
export function applicationStepStatusText(status: ApplicationStepStatus): string {
  switch (status.kind) {
    case "done":
      return "Done";
    case "current":
      return "Current step";
    case "blocked":
      return `Blocked: ${status.reason}`;
  }
}
