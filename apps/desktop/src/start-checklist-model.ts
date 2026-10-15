import type { WorkspaceReadiness } from "./model.js";
import type { RequirementRefusalAction } from "./start-requirements-model.js";

/**
 * The start conditions shown beside the Start button: what has to be true before the first
 * author–critic review, each stated as done or not done with the action that fixes it.
 */

export const startChecklistId = "start-checklist";
/** DOM id of the job and requirements setup card, so a checklist action can reveal it. */
export const startJobCardId = "start-job-card";

export const candidateProfileStartBlockerMessage =
  "Select an exact reviewed candidate profile before starting a review.";
export const candidateProfilePendingBlockerMessage =
  "Wait for the candidate profile operation to finish before starting a review.";

/**
 * The host's wording for a missing job description (see `electron/host.ts` and
 * `electron/host-applications.ts`). A step that matches folds into the requirements condition;
 * one that drifts still shows as its own unmet item.
 */
export const jobDescriptionSteps: readonly string[] = [
  "Add a target job description.",
  "Extract and review requirements from this application's job posting before starting.",
];

const setupIncompleteFallback = "Finish the workspace setup above.";

export type StartActionId =
  | "add-job-description"
  | "review-requirements"
  | "extract-requirements"
  | "use-reviewed-requirements"
  | "choose-profile"
  | "open-provider-sign-in"
  | "review-data-sent";

export interface StartConditionAction {
  readonly id: StartActionId;
  readonly label: string;
}

export interface StartCondition {
  readonly id: string;
  readonly label: string;
  readonly done: boolean;
  /**
   * The renderer cannot tell, and the host checks it when the review starts. Such a condition is
   * not done but never blocks the button; a host refusal names it instead.
   */
  readonly checkedAtStart?: boolean;
  readonly action: StartConditionAction | null;
  readonly detail?: string;
}

export interface StartChecklistInput {
  readonly setup: Pick<
    WorkspaceReadiness,
    "ready" | "nextSteps" | "jobDescriptionReady" | "jobRequirementProblem" | "fixtureMode"
  > & { readonly reviewedOpportunity?: unknown };
  /** The person chose to start from the raw job description instead of the reviewed brief. */
  readonly startFromJobDescription: boolean;
  /** What fixes the parser's refusal of the raw job description, from `requirementRefusalAction`. */
  readonly requirementAction: RequirementRefusalAction;
  /** The profile a new run pins; `undefined` when the host does not pin profiles. */
  readonly candidateProfile: { readonly version: number } | null | undefined;
  readonly transmission: { readonly required: boolean; readonly acknowledged: boolean };
  /** The host's refusal to start, such as a missing profile or an unsupported model pair. */
  readonly startDisabledReason: string | null;
  readonly canOpenProviderSignIn: boolean;
}

const requirementsLabel = "Job requirements reviewed";

function requirementRefusalFix(action: RequirementRefusalAction): StartConditionAction | null {
  switch (action) {
    case "use-reviewed":
      return { id: "use-reviewed-requirements", label: "Use the reviewed requirements instead" };
    case "review-draft":
      return { id: "review-requirements", label: "Review requirements" };
    case "extract":
      return { id: "extract-requirements", label: "Extract requirements into a brief" };
    case "extract-again":
      return { id: "extract-requirements", label: "Extract requirements again" };
    default:
      return null;
  }
}

function requirementsCondition(
  input: StartChecklistInput,
  steps: readonly string[],
  refusal: string | null,
): StartCondition {
  if (!input.setup.jobDescriptionReady) {
    return {
      id: "requirements",
      label: requirementsLabel,
      done: false,
      detail:
        steps.find((step) => jobDescriptionSteps.includes(step)) ??
        "Add the target job description.",
      action:
        input.requirementAction === "review-draft"
          ? requirementRefusalFix("review-draft")
          : { id: "add-job-description", label: "Add job description" },
    };
  }
  if (refusal !== null) {
    return {
      id: "requirements",
      label: requirementsLabel,
      done: false,
      detail: refusal,
      action: requirementRefusalFix(input.requirementAction),
    };
  }
  const reviewed =
    input.setup.reviewedOpportunity !== null &&
    input.setup.reviewedOpportunity !== undefined &&
    !input.startFromJobDescription;
  return reviewed
    ? { id: "requirements", label: requirementsLabel, done: true, action: null }
    : {
        id: "requirements",
        label: "Job requirements read from the job description",
        done: true,
        action: null,
      };
}

function profileCondition(input: StartChecklistInput): StartCondition | null {
  const label = "Reviewed career profile selected";
  const reason = input.startDisabledReason;
  if (reason === candidateProfilePendingBlockerMessage) {
    return { id: "profile", label, done: false, detail: reason, action: null };
  }
  if (input.candidateProfile !== null && input.candidateProfile !== undefined) {
    return {
      id: "profile",
      label,
      done: true,
      detail: `Version ${input.candidateProfile.version}.`,
      action: null,
    };
  }
  if (reason === candidateProfileStartBlockerMessage) {
    return {
      id: "profile",
      label,
      done: false,
      detail: reason,
      action: { id: "choose-profile", label: "Choose profile" },
    };
  }
  // Nothing asks for a profile: this host starts without one.
  return null;
}

function providerSignInCondition(input: StartChecklistInput): StartCondition {
  const label = "Provider sign-in ready";
  if (input.setup.fixtureMode || !input.transmission.required) {
    return {
      id: "provider-sign-in",
      label,
      done: true,
      detail: "Nothing is sent to a provider from this workspace.",
      action: null,
    };
  }
  return {
    id: "provider-sign-in",
    label,
    done: false,
    checkedAtStart: true,
    detail: "Sign-in is on Home, under Workspace settings.",
    action: input.canOpenProviderSignIn
      ? { id: "open-provider-sign-in", label: "Open provider sign-in" }
      : null,
  };
}

function transmissionCondition(input: StartChecklistInput): StartCondition {
  const label = "Data sent to providers acknowledged";
  const { required, acknowledged } = input.transmission;
  if (!required || acknowledged) {
    return {
      id: "transmission",
      label,
      done: true,
      ...(required ? {} : { detail: "Nothing leaves this workspace." }),
      action: null,
    };
  }
  return {
    id: "transmission",
    label,
    done: false,
    detail: "Acknowledge provider transmission above.",
    action: { id: "review-data-sent", label: "Review data sent" },
  };
}

/**
 * Every start condition in reading order: a host refusal first, then the job requirements, the
 * career profile, provider sign-in and the transmission acknowledgement, then any other setup
 * step the host reports. Every host step stays in the list, so no blocker is unreachable.
 */
export function startChecklist(input: StartChecklistInput): readonly StartCondition[] {
  const steps = input.setup.ready
    ? []
    : input.setup.nextSteps.length > 0
      ? input.setup.nextSteps
      : [setupIncompleteFallback];
  const problem = input.setup.jobRequirementProblem ?? null;
  const refusal =
    problem !== null && (steps.includes(problem) || input.startFromJobDescription) ? problem : null;
  const reason = input.startDisabledReason;
  const conditions: StartCondition[] = [];
  if (
    reason !== null &&
    reason !== candidateProfileStartBlockerMessage &&
    reason !== candidateProfilePendingBlockerMessage
  ) {
    conditions.push({ id: "host-refusal", label: reason, done: false, action: null });
  }
  conditions.push(requirementsCondition(input, steps, refusal));
  const profile = profileCondition(input);
  if (profile !== null) conditions.push(profile);
  conditions.push(providerSignInCondition(input), transmissionCondition(input));
  const otherSteps = steps.filter(
    (step) =>
      step !== problem && !(jobDescriptionSteps.includes(step) && !input.setup.jobDescriptionReady),
  );
  return [
    ...conditions,
    ...otherSteps.map((step, index) => ({
      id: `setup-${index}`,
      label: step,
      done: false,
      action: null,
    })),
  ];
}

/** Whether a condition stops the review from starting. */
export function blocksStart(condition: StartCondition): boolean {
  return !condition.done && condition.checkedAtStart !== true;
}

/** The first condition that blocks the start, or `null` once the review can start. */
export function firstUnmetStartCondition(
  conditions: readonly StartCondition[],
): StartCondition | null {
  return conditions.find(blocksStart) ?? null;
}

function blockedHint(condition: StartCondition): string {
  switch (condition.id) {
    case "host-refusal":
      return "see why below";
    case "requirements":
      return condition.action?.id === "add-job-description"
        ? "add the job description first"
        : "review the requirements first";
    case "profile":
      return condition.action === null ? "wait for the profile" : "choose a profile first";
    case "transmission":
      return "review the data sent first";
    default:
      return "finish the setup first";
  }
}

/** The Start button's text: it names the first unmet condition while the start is blocked. */
export function startButtonLabel(conditions: readonly StartCondition[], pending: boolean): string {
  if (pending) return "Starting review…";
  const first = firstUnmetStartCondition(conditions);
  return first === null ? "Start author–critic review" : `Start review · ${blockedHint(first)}`;
}

/** Hover text for the disabled start button; undefined once nothing blocks it. */
export function startChecklistTooltip(conditions: readonly StartCondition[]): string | undefined {
  const unmet = conditions.filter(blocksStart);
  return unmet.length === 0
    ? undefined
    : `Can't start yet: ${unmet.map((condition) => condition.detail ?? condition.label).join(" ")}`;
}
