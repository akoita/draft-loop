import type { ApplicationSummaryView } from "./application-contract.js";
import type { CareerEvidenceStatus } from "./career-evidence.js";
import type { DisplayPreference } from "./display-preference.js";
import type { HomeApplicationsState, HomeProfileStatus } from "./home-model.js";

/** The Getting started steps on Home (#2791), from the career story to a downloaded CV. */
export type GettingStartedStepKey = "career" | "profile" | "job" | "review" | "download";

/**
 * Where the followed application's review stands: no run yet, a review that stopped or ran out of
 * budget before approval, or a review going on.
 */
export type GettingStartedReviewState = "not-started" | "ended" | "ongoing";

export interface GettingStartedStep {
  readonly key: GettingStartedStepKey;
  /** Ticked from the record's real state; the person never ticks a step. */
  readonly done: boolean;
  /** The application a review or download step opens; null for the other steps. */
  readonly application: ApplicationSummaryView | null;
  /** The followed application's review state, on the review step only. */
  readonly reviewState?: GettingStartedReviewState;
}

export interface GettingStartedInputs {
  readonly evidence: CareerEvidenceStatus;
  readonly legacyEvidenceSourceCount: number;
  readonly profile: HomeProfileStatus;
  readonly applications: HomeApplicationsState;
}

/** What the guide shows: the whole list, the one-line offer, a folded line, or nothing. */
export type GettingStartedView =
  | { readonly kind: "hidden" }
  | { readonly kind: "offer" }
  /** Guided, with every step done: one line that says so, so Guided never looks like Simple. */
  | { readonly kind: "complete"; readonly steps: readonly GettingStartedStep[] }
  | {
      readonly kind: "guide";
      readonly folded: boolean;
      readonly steps: readonly GettingStartedStep[];
      /** The first step not done; the list is never shown once every step is. */
      readonly current: GettingStartedStep;
      readonly position: number;
    };

function hasEvidence(inputs: GettingStartedInputs): boolean {
  if (inputs.legacyEvidenceSourceCount > 0) return true;
  return inputs.evidence.kind === "selected" && inputs.evidence.sourceCount > 0;
}

function shownApplications(state: HomeApplicationsState): readonly ApplicationSummaryView[] {
  if (state.status !== "ready") return [];
  return state.applications.filter(
    (application) => application.archivedAt === null && application.jobMissing !== true,
  );
}

function newest(applications: readonly ApplicationSummaryView[]): ApplicationSummaryView | null {
  return applications.reduce<ApplicationSummaryView | null>(
    (best, application) =>
      best === null || application.updatedAt > best.updatedAt ? application : best,
    null,
  );
}

function reviewState(application: ApplicationSummaryView | null): GettingStartedReviewState {
  if (application === null || application.runCount === 0) return "not-started";
  return application.latestRunEnded === true ? "ended" : "ongoing";
}

/**
 * The steps in order, each ticked from what the record holds. The review and download steps
 * follow one application, the one the person worked on last, so an older finished application
 * never ticks them for a newer one. A host without a profile workflow skips the profile step
 * rather than show one the person cannot finish.
 */
export function gettingStartedSteps(inputs: GettingStartedInputs): readonly GettingStartedStep[] {
  const applications = shownApplications(inputs.applications);
  const followed = newest(applications);
  const exported =
    followed !== null && (followed.status === "exported" || followed.exportCount > 0);
  const approved = followed !== null && (exported || followed.status === "approved");
  const steps: GettingStartedStep[] = [
    { key: "career", done: hasEvidence(inputs), application: null },
  ];
  if (inputs.profile.kind !== "unsupported") {
    steps.push({ key: "profile", done: inputs.profile.kind === "reviewed", application: null });
  }
  steps.push(
    { key: "job", done: applications.length > 0, application: null },
    {
      key: "review",
      done: approved,
      application: followed,
      reviewState: reviewState(followed),
    },
    { key: "download", done: exported, application: followed },
  );
  return steps;
}

/**
 * Who sees what: Guided people see the list (folded to one line once hidden), people on the
 * simple view see a one-line offer until they decline it, and Show everything sees nothing. Once
 * every step is done, Guided people see one line that says so until they hide it, and everyone
 * else sees nothing. The guide waits while the record is still loading.
 */
export function gettingStartedView(
  preference: DisplayPreference,
  inputs: GettingStartedInputs,
): GettingStartedView {
  if (preference.mode === null || preference.mode === "everything") return { kind: "hidden" };
  if (inputs.applications.status === "loading" || inputs.evidence.kind === "loading") {
    return { kind: "hidden" };
  }
  const steps = gettingStartedSteps(inputs);
  const index = steps.findIndex((step) => !step.done);
  const current = index === -1 ? undefined : steps.at(index);
  if (current === undefined) {
    return preference.mode === "guided" && !preference.guideHidden
      ? { kind: "complete", steps }
      : { kind: "hidden" };
  }
  if (preference.mode === "standard") {
    return preference.guideHidden ? { kind: "hidden" } : { kind: "offer" };
  }
  return { kind: "guide", folded: preference.guideHidden, steps, current, position: index + 1 };
}
