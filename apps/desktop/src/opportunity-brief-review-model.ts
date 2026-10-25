import type {
  OpportunityEditInput,
  OpportunityEditPatch,
  OpportunityIssueResult,
  OpportunityRecordResult,
  OpportunityRequirementResult,
  OpportunitySourceResult,
} from "@draft-loop/ui/bridge";

/**
 * The fixed sentence the host sends when an opportunity edit or review used an out-of-date
 * version. The renderer matches it to offer a reload instead of a generic failure.
 */
export const opportunityVersionConflictMessage =
  "This brief changed since you opened it. The latest version has been loaded; review it and try again.";

export const maximumRequirementTextLength = 2_000;

export type RequirementPriority = OpportunityRequirementResult["priority"];

export const requirementPriorityOptions: readonly {
  readonly value: RequirementPriority;
  readonly label: string;
}[] = [
  { value: "critical", label: "Critical" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

/** A plain label for a brief source, from its kind and classification; never its internal id. */
export function briefSourceLabel(source: OpportunitySourceResult | undefined): string {
  if (source === undefined) return "Unlisted source";
  if (source.classification === "candidate-provided-fact") return "Entered by you";
  if (source.classification === "candidate-instruction" || source.kind === "candidate-input") {
    return "Your instructions";
  }
  if (source.classification === "social-announcement") return "Social announcement";
  if (source.classification === "company-context") return "Company context";
  if (source.kind === "approved-url") return "Job page";
  if (source.kind === "pasted-content") return "Pasted job text";
  return "Job posting";
}

/** The sources an entry cites, as distinct plain labels in citation order. */
export function describeBriefSources(
  sources: readonly OpportunitySourceResult[],
  sourceIds: readonly string[],
): string {
  const labels = sourceIds.map((id) =>
    briefSourceLabel(sources.find((candidate) => candidate.id === id)),
  );
  return [...new Set(labels)].join(", ");
}

/** The status line shown, and focused, after a save created the next draft. */
export function savedBriefNote(version: number): string {
  return `Saved as draft v${version}. Mark it reviewed when it is ready.`;
}

export function requirementPriorityLabel(priority: RequirementPriority): string {
  return requirementPriorityOptions.find((option) => option.value === priority)?.label ?? priority;
}

/** One requirement while it is being edited; nothing here is saved until the person saves. */
export interface RequirementDraft {
  readonly id: string;
  readonly text: string;
  readonly priority: RequirementPriority;
  readonly sourceIds: readonly string[];
  /** The job-text quotation the requirement came from; editing the wording never changes it. */
  readonly excerpt?: string;
  readonly dropped: boolean;
}

export interface BriefEditState {
  readonly requirements: readonly RequirementDraft[];
  readonly acknowledgedIssueIds: readonly string[];
  /** The employer the person typed for a brief that names none; empty when they typed nothing. */
  readonly employer: string;
}

/** Whether the brief has no employer, so the person may enter the one they know. */
export function canEnterEmployer(record: OpportunityRecordResult): boolean {
  return record.employer === null;
}

/** Whether the employer was typed by the person rather than read from the job posting. */
export function isEmployerEnteredByYou(record: OpportunityRecordResult): boolean {
  const cited = record.employer?.sourceIds ?? [];
  return (
    cited.length > 0 &&
    cited.every(
      (id) =>
        record.sources.find((source) => source.id === id)?.classification ===
        "candidate-provided-fact",
    )
  );
}

export const editEmployer = (state: BriefEditState, employer: string): BriefEditState => ({
  ...state,
  employer,
});

export function createBriefEditState(record: OpportunityRecordResult): BriefEditState {
  return {
    requirements: record.requirements.map((requirement) => ({ ...requirement, dropped: false })),
    acknowledgedIssueIds: [],
    employer: "",
  };
}

function updateRequirement(
  state: BriefEditState,
  id: string,
  change: (requirement: RequirementDraft) => RequirementDraft,
): BriefEditState {
  return {
    ...state,
    requirements: state.requirements.map((requirement) =>
      requirement.id === id ? change(requirement) : requirement,
    ),
  };
}

export const editRequirementText = (state: BriefEditState, id: string, text: string) =>
  updateRequirement(state, id, (requirement) => ({ ...requirement, text }));

export const setRequirementPriority = (
  state: BriefEditState,
  id: string,
  priority: RequirementPriority,
) => updateRequirement(state, id, (requirement) => ({ ...requirement, priority }));

export const dropRequirement = (state: BriefEditState, id: string) =>
  updateRequirement(state, id, (requirement) => ({ ...requirement, dropped: true }));

export const restoreRequirement = (state: BriefEditState, id: string) =>
  updateRequirement(state, id, (requirement) => ({ ...requirement, dropped: false }));

export function acknowledgeIssue(state: BriefEditState, id: string): BriefEditState {
  return state.acknowledgedIssueIds.includes(id)
    ? state
    : { ...state, acknowledgedIssueIds: [...state.acknowledgedIssueIds, id] };
}

function keptRequirements(state: BriefEditState): readonly RequirementDraft[] {
  return state.requirements.filter((requirement) => !requirement.dropped);
}

function requirementsChanged(record: OpportunityRecordResult, state: BriefEditState): boolean {
  const kept = keptRequirements(state);
  return (
    kept.length !== record.requirements.length ||
    kept.some((requirement, index) => {
      const saved = record.requirements[index];
      return (
        saved === undefined ||
        saved.id !== requirement.id ||
        saved.text !== requirement.text.trim() ||
        saved.priority !== requirement.priority
      );
    })
  );
}

/** The trimmed employer to record, or `null` when none was typed or the brief already has one. */
function enteredEmployer(record: OpportunityRecordResult, state: BriefEditState): string | null {
  const typed = state.employer.trim();
  return canEnterEmployer(record) && typed !== "" ? typed : null;
}

export function hasUnsavedBriefChanges(
  record: OpportunityRecordResult,
  state: BriefEditState,
): boolean {
  return (
    state.acknowledgedIssueIds.length > 0 ||
    requirementsChanged(record, state) ||
    enteredEmployer(record, state) !== null
  );
}

/** Why the staged edit cannot be saved, or `null` when it can. */
export function briefEditProblem(state: BriefEditState): string | null {
  const kept = keptRequirements(state);
  if (kept.some((requirement) => requirement.text.trim() === "")) {
    return "A requirement cannot be empty. Write it out or drop it.";
  }
  if (kept.some((requirement) => requirement.text.trim().length > maximumRequirementTextLength)) {
    return `A requirement can be at most ${maximumRequirementTextLength} characters.`;
  }
  if (state.employer.trim().length > maximumRequirementTextLength) {
    return `The employer can be at most ${maximumRequirementTextLength} characters.`;
  }
  return null;
}

/**
 * The `opportunity.edit` patch for the staged changes. Dropped requirements are omitted from the
 * list; kept ones keep their id and source references, so an edit never invents a source. An
 * employer the person typed is sent as `candidateEmployer`, which the application records as
 * theirs and never as something the job posting says.
 */
export function buildBriefEditPatch(
  record: OpportunityRecordResult,
  state: BriefEditState,
): OpportunityEditPatch {
  const acknowledge = (issue: OpportunityIssueResult): OpportunityIssueResult =>
    issue.status === "open" && state.acknowledgedIssueIds.includes(issue.id)
      ? { ...issue, status: "acknowledged" }
      : issue;
  const employer = enteredEmployer(record, state);
  return {
    ...(employer === null ? {} : { candidateEmployer: employer }),
    ...(requirementsChanged(record, state)
      ? {
          requirements: keptRequirements(state).map((requirement) => ({
            id: requirement.id,
            text: requirement.text.trim(),
            priority: requirement.priority,
            sourceIds: [...requirement.sourceIds],
            ...(requirement.excerpt === undefined ? {} : { excerpt: requirement.excerpt }),
          })),
        }
      : {}),
    ...(state.acknowledgedIssueIds.length === 0 ? {} : { issues: record.issues.map(acknowledge) }),
  };
}

/**
 * What stops a saved draft from being marked reviewed; empty when it is ready. A job posting that
 * names no employer does not block review: only the person may enter one, as their own.
 */
export function reviewBlockers(record: OpportunityRecordResult): readonly string[] {
  const blockers: string[] = [];
  if (record.role === null) blockers.push("The brief has no role.");
  if (record.requirements.length === 0) blockers.push("Keep at least one requirement.");
  const open = record.issues.filter((issue) => issue.status === "open").length;
  if (open > 0) {
    blockers.push(
      `Acknowledge or resolve the ${open === 1 ? "open issue" : `${open} open issues`} first.`,
    );
  }
  return blockers;
}

/**
 * The reason shown beside a disabled Mark reviewed, or `null` when none is needed. Unsaved
 * changes have their own note above the actions, so they add no reason here.
 */
export function markReviewedDisabledReason(
  record: OpportunityRecordResult,
  dirty: boolean,
): string | null {
  if (record.status === "reviewed" || dirty) return null;
  return reviewBlockers(record)[0] ?? null;
}

export type BriefOperationOutcome =
  | { readonly kind: "done"; readonly record: OpportunityRecordResult }
  | { readonly kind: "conflict"; readonly message: string }
  | { readonly kind: "failed"; readonly message: string };

export interface BriefOperations {
  readonly getOpportunity: (briefId: string, version?: number) => Promise<OpportunityRecordResult>;
  readonly editOpportunity: (
    input: Omit<OpportunityEditInput, "workspaceId">,
  ) => Promise<OpportunityRecordResult>;
  readonly reviewOpportunity: (
    briefId: string,
    expectedVersion: number,
  ) => Promise<OpportunityRecordResult>;
}

function failure(reason: unknown, fallback: string): BriefOperationOutcome {
  const message = reason instanceof Error && reason.message.trim() !== "" ? reason.message : "";
  if (message === opportunityVersionConflictMessage) return { kind: "conflict", message };
  return { kind: "failed", message: message === "" ? fallback : message };
}

/** Saves the staged edit as the next draft version, guarded by the version the person read. */
export async function saveBriefEdits(
  operations: Pick<BriefOperations, "editOpportunity">,
  record: OpportunityRecordResult,
  state: BriefEditState,
): Promise<BriefOperationOutcome> {
  try {
    return {
      kind: "done",
      record: await operations.editOpportunity({
        briefId: record.briefId,
        expectedVersion: record.version,
        patch: buildBriefEditPatch(record, state),
      }),
    };
  } catch (reason: unknown) {
    return failure(reason, "The requirements could not be saved. Nothing was changed.");
  }
}

/** Marks the exact version the person read as reviewed. */
export async function reviewBrief(
  operations: Pick<BriefOperations, "reviewOpportunity">,
  record: OpportunityRecordResult,
): Promise<BriefOperationOutcome> {
  try {
    return {
      kind: "done",
      record: await operations.reviewOpportunity(record.briefId, record.version),
    };
  } catch (reason: unknown) {
    return failure(reason, "The brief could not be marked reviewed. Nothing was changed.");
  }
}

export async function loadBrief(
  operations: Pick<BriefOperations, "getOpportunity">,
  briefId: string,
): Promise<BriefOperationOutcome> {
  try {
    return { kind: "done", record: await operations.getOpportunity(briefId) };
  } catch (reason: unknown) {
    return failure(reason, "The brief could not be loaded.");
  }
}
