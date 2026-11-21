import { t } from "@lingui/core/macro";

import type { ApplicationSummaryView } from "./application-contract.js";
import type { CareerEvidenceStatus } from "./career-evidence.js";
import type { HomeApplicationsState, HomeProfileStatus } from "./home-model.js";

/**
 * Where the person stands, read once from the record (#3224). Every guidance surface (Getting
 * started, hint lines, status chips, help) asks this instead of working the state out itself, so
 * they all say the same thing.
 *
 * - `career`, `profile`, `job`: the record is missing that input.
 * - `start-review`: the followed application has no run yet.
 * - `drafting`: its review is writing the first draft.
 * - `reviewing`: its draft is waiting for the person's decisions and approval.
 * - `review-ended`: its newest review stopped or ran out of budget before an approval.
 * - `export`: its CV is approved and not downloaded yet.
 * - `done`: its CV is downloaded.
 */
export type NextStepStage =
  | "career"
  | "profile"
  | "job"
  | "start-review"
  | "drafting"
  | "reviewing"
  | "review-ended"
  | "export"
  | "done";

/** The stages of an application, once the record holds its career inputs and a job. */
export type ApplicationStage = Exclude<NextStepStage, "career" | "profile" | "job">;

export interface NextStepInputs {
  readonly evidence: CareerEvidenceStatus;
  readonly legacyEvidenceSourceCount: number;
  readonly profile: HomeProfileStatus;
  readonly applications: HomeApplicationsState;
}

export interface NextStep {
  readonly stage: NextStepStage;
  /** The application the person worked on last; null before the first one. */
  readonly application: ApplicationSummaryView | null;
}

/** The applications Home lists: not archived, and with a job. */
export function followedApplications(
  state: HomeApplicationsState,
): readonly ApplicationSummaryView[] {
  if (state.status !== "ready") return [];
  return state.applications.filter(
    (application) => application.archivedAt === null && application.jobMissing !== true,
  );
}

/** The application the person worked on last, which the guidance follows. */
export function followedApplication(
  applications: readonly ApplicationSummaryView[],
): ApplicationSummaryView | null {
  return applications.reduce<ApplicationSummaryView | null>(
    (best, application) =>
      best === null || application.updatedAt > best.updatedAt ? application : best,
    null,
  );
}

export function hasCareerEvidence(inputs: NextStepInputs): boolean {
  if (inputs.legacyEvidenceSourceCount > 0) return true;
  return inputs.evidence.kind === "selected" && inputs.evidence.sourceCount > 0;
}

/** One application's stage, from its saved status and its newest run. */
export function applicationStage(application: ApplicationSummaryView): ApplicationStage {
  if (application.status === "exported" || application.exportCount > 0) return "done";
  if (application.status === "approved") return "export";
  if (application.runCount === 0) return "start-review";
  if (application.latestRunEnded === true) return "review-ended";
  return application.status === "in-review" ? "reviewing" : "drafting";
}

/**
 * The one step the person takes next, in the order of the first journey. A host without a
 * profile workflow never asks for the profile.
 */
export function nextStep(inputs: NextStepInputs): NextStep {
  const application = followedApplication(followedApplications(inputs.applications));
  if (!hasCareerEvidence(inputs)) return { stage: "career", application };
  if (inputs.profile.kind !== "unsupported" && inputs.profile.kind !== "reviewed") {
    return { stage: "profile", application };
  }
  if (application === null) return { stage: "job", application };
  return { stage: applicationStage(application), application };
}

/** What to do at an application stage, in one sentence without the application's name. */
export function applicationStageAction(stage: ApplicationStage): string {
  switch (stage) {
    case "start-review":
      return t`Start the review to get a first draft.`;
    case "drafting":
      return t`The first draft is being written. Open the application to follow it.`;
    case "reviewing":
      return t`Read the draft, accept or reject each finding, then approve it.`;
    case "review-ended":
      return t`The last review stopped before you approved a CV. Open it and start a new review from Run details.`;
    case "export":
      return t`The CV is approved. Pick a template and export it.`;
    case "done":
      return t`The CV is downloaded. Select New application for your next job.`;
  }
}

/** The next step as one sentence, led by the followed application's name where it has one. */
export function nextStepSentence(step: NextStep): string {
  switch (step.stage) {
    case "career":
      return t`Add a CV or other documents in Career evidence, or tell your story in a conversation.`;
    case "profile":
      return t`Read the facts in Career profile, then confirm or fix them.`;
    case "job":
      return t`Select New application and paste the job you want.`;
    default: {
      const action = applicationStageAction(step.stage);
      const name = step.application?.name;
      return name === undefined ? action : t`${name}: ${action}`;
    }
  }
}
