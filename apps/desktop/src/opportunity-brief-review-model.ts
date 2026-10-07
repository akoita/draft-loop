import type {
  OpportunityEditInput,
  OpportunityEditPatch,
  OpportunityIssueResult,
  OpportunityRecordResult,
  OpportunityRequirementResult,
} from "./bridge.js";

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
}

export function createBriefEditState(record: OpportunityRecordResult): BriefEditState {
  return {
    requirements: record.requirements.map((requirement) => ({ ...requirement, dropped: false })),
    acknowledgedIssueIds: [],
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

export function hasUnsavedBriefChanges(
  record: OpportunityRecordResult,
  state: BriefEditState,
): boolean {
  return state.acknowledgedIssueIds.length > 0 || requirementsChanged(record, state);
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
  return null;
}

/**
 * The `opportunity.edit` patch for the staged changes. Dropped requirements are omitted from the
 * list; kept ones keep their id and source references, so an edit never invents a source.
 */
export function buildBriefEditPatch(
  record: OpportunityRecordResult,
  state: BriefEditState,
): OpportunityEditPatch {
  const acknowledge = (issue: OpportunityIssueResult): OpportunityIssueResult =>
    issue.status === "open" && state.acknowledgedIssueIds.includes(issue.id)
      ? { ...issue, status: "acknowledged" }
      : issue;
  return {
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

/** What stops a saved draft from being marked reviewed; empty when it is ready. */
export function reviewBlockers(record: OpportunityRecordResult): readonly string[] {
  const blockers: string[] = [];
  if (record.role === null) blockers.push("The brief has no role.");
  if (record.employer === null) blockers.push("The brief has no employer.");
  if (record.requirements.length === 0) blockers.push("Keep at least one requirement.");
  const open = record.issues.filter((issue) => issue.status === "open").length;
  if (open > 0) {
    blockers.push(
      `Acknowledge or resolve the ${open === 1 ? "open issue" : `${open} open issues`} first.`,
    );
  }
  return blockers;
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
