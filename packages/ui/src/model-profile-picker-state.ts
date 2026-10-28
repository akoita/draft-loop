import {
  type ChoosableModelProfileEffort,
  isChoosableModelProfileEffort,
  listModelProfileCatalog,
  listModelProfilePresets,
  type ModelProfileCatalogEntry,
  type ModelProfilePreset,
} from "@draft-loop/application/model-profile-catalog";
import type { ModelProfileReferences } from "@draft-loop/application/model-profile-selection";
import type {
  ModelCompany,
  ModelProfileSupportResult,
  SavedModelProfilesResult,
  WorkspaceConfigureModelsInput,
} from "./bridge.js";
import type { DesktopReviewState, ReviewAction } from "./model.js";
import { effortDisplayName } from "./model-profile-presentation.js";

export interface AppliedModelProfileSelection {
  readonly workspaceId: string;
  readonly generation: number;
  readonly refs: ModelProfileReferences;
}

export type ModelProfileSupportState =
  | { readonly status: "idle" }
  | { readonly status: "loading"; readonly workspaceId: string; readonly generation: number }
  | { readonly status: "unavailable"; readonly workspaceId: string; readonly generation: number }
  | {
      readonly status: "ready";
      readonly workspaceId: string;
      readonly generation: number;
      readonly result: ModelProfileSupportResult;
    };

/** What the host reports about the pair saved for the open workspace. */
export type SavedModelProfilesState =
  | { readonly status: "idle" }
  | { readonly status: "loading"; readonly workspaceId: string; readonly generation: number }
  | { readonly status: "unavailable"; readonly workspaceId: string; readonly generation: number }
  | {
      readonly status: "ready";
      readonly workspaceId: string;
      readonly generation: number;
      readonly result: SavedModelProfilesResult;
    };

/** The pair a new run will use, or null when the saved pair is absent or no longer fits. */
export function usableSavedModelProfiles(
  result: SavedModelProfilesResult,
): ModelProfileReferences | null {
  return result.ignoredReason === null ? result.modelProfiles : null;
}

/** The apply failed after the models changed, because the pair could not be saved. */
export class ModelProfileSaveError extends Error {
  constructor(detail?: string) {
    super(
      `The models were configured, but the profile pair could not be saved for future runs.${
        detail === undefined || detail === "" ? "" : ` ${detail}`
      } It is not applied.`,
    );
    this.name = "ModelProfileSaveError";
  }
}

/** What the dialog says when applying failed; only a failed save names its own reason. */
export function modelProfileApplyErrorMessage(reason: unknown): string {
  return reason instanceof ModelProfileSaveError
    ? reason.message
    : "The profile pair could not be applied. Your draft is unchanged.";
}

export const noModelProfilesWarning =
  "No model profiles: provider defaults, unknown context windows.";

function describeReferences(references: ModelProfileReferences): string {
  return `author ${references.author.id}@${references.author.version}; critic ${references.critic.id}@${references.critic.version}`;
}

/**
 * Why the next run attaches no saved profiles even though the workspace may have some, or null when
 * there is nothing to explain. Only a settled answer for this workspace is described.
 */
export function savedModelProfilesNotice(
  saved: SavedModelProfilesState,
  workspaceId: string,
  generation: number,
): string | null {
  if (
    saved.status === "idle" ||
    saved.workspaceId !== workspaceId ||
    saved.generation !== generation
  ) {
    return null;
  }
  if (saved.status === "unavailable") {
    return "The saved profile pair could not be read, so it is not shown. Apply a pair again or check the workspace.";
  }
  if (saved.status !== "ready") return null;
  const { modelProfiles, ignoredReason } = saved.result;
  if (modelProfiles === null || ignoredReason === null) return null;
  return `The saved profile pair (${describeReferences(modelProfiles)}) is not used because ${ignoredReason}.`;
}

/** The warning shown beside the configured models when the next run would attach no profiles. */
export function modelProfileWarning(
  applied: AppliedModelProfileSelection | null,
  saved: SavedModelProfilesState,
  workspaceId: string,
  generation: number,
): string | null {
  if (applied !== null) return null;
  if (saved.status === "idle" || saved.status === "loading") return null;
  if (saved.workspaceId !== workspaceId || saved.generation !== generation) return null;
  const notice = savedModelProfilesNotice(saved, workspaceId, generation);
  return notice === null ? noModelProfilesWarning : `${notice} ${noModelProfilesWarning}`;
}

export const modelProfileCatalog = listModelProfileCatalog();
export const modelProfilePresets = listModelProfilePresets();

export const modelProfileSupportUnavailableMessage =
  "Profile route support could not be checked. Retry or use the workspace model settings.";
export const modelProfilePairMismatchMessage =
  "The applied profiles no longer match the configured workspace models. Apply them again before starting a new run.";
export const modelProfileNotSupportedMessage =
  "The configured authentication route does not support one or both selected profiles.";
export const modelProfileApplyDisabledMessage =
  "Select one supported author profile and one supported critic profile before applying.";

export function modelProfileEntryForReference(
  reference: { readonly id: string; readonly version: number },
  role: "author" | "critic",
  catalog: readonly ModelProfileCatalogEntry[] = modelProfileCatalog,
): ModelProfileCatalogEntry | undefined {
  return catalog.find(
    ({ profile }) =>
      profile.id === reference.id &&
      profile.version === reference.version &&
      profile.roles.includes(role),
  );
}

export function modelProfilePresetReferences(
  preset: ModelProfilePreset,
  catalog: readonly ModelProfileCatalogEntry[] = modelProfileCatalog,
): ModelProfileReferences | null {
  const author = modelProfileEntryForReference(preset.author, "author", catalog);
  const critic = modelProfileEntryForReference(preset.critic, "critic", catalog);
  if (author === undefined || critic === undefined) return null;
  return { author: { ...preset.author }, critic: { ...preset.critic } };
}

/** Whether two pairs name the same exact profiles, whatever reasoning levels they choose. */
export function modelProfileReferencesEqual(
  left: ModelProfileReferences | null,
  right: ModelProfileReferences | null,
): boolean {
  return (
    left === right ||
    (left !== null &&
      right !== null &&
      left.author.id === right.author.id &&
      left.author.version === right.author.version &&
      left.critic.id === right.critic.id &&
      left.critic.version === right.critic.version)
  );
}

export function modelProfileRouteIsSupported(
  reference: { readonly id: string; readonly version: number },
  support: ModelProfileSupportResult,
): boolean {
  return support.profiles.some(
    (entry) => entry.id === reference.id && entry.version === reference.version && entry.supported,
  );
}

export function modelProfileSupportForContext(
  support: ModelProfileSupportState,
  workspaceId: string,
  generation: number,
): ModelProfileSupportState | null {
  if (support.status === "idle") return null;
  return support.workspaceId === workspaceId && support.generation === generation ? support : null;
}

export function modelProfileStartDisabledReason(
  applied: AppliedModelProfileSelection | null,
  workspaceId: string,
  generation: number,
  supportState: ModelProfileSupportState,
  preflight: DesktopReviewState["providerTransmissionPreflight"],
): string | null {
  if (applied === null) return null;
  if (applied.workspaceId !== workspaceId || applied.generation !== generation) {
    return modelProfileSupportUnavailableMessage;
  }
  const contextualSupport = modelProfileSupportForContext(supportState, workspaceId, generation);
  if (contextualSupport?.status !== "ready") return modelProfileSupportUnavailableMessage;
  const author = modelProfileEntryForReference(applied.refs.author, "author");
  const critic = modelProfileEntryForReference(applied.refs.critic, "critic");
  if (author === undefined || critic === undefined) return modelProfileSupportUnavailableMessage;
  if (
    !modelProfileRouteIsSupported(applied.refs.author, contextualSupport.result) ||
    !modelProfileRouteIsSupported(applied.refs.critic, contextualSupport.result)
  ) {
    return modelProfileNotSupportedMessage;
  }
  if (
    preflight.author.company !== author.profile.provider ||
    preflight.author.model !== author.profile.modelId ||
    preflight.critic.company !== critic.profile.provider ||
    preflight.critic.model !== critic.profile.modelId
  ) {
    return modelProfilePairMismatchMessage;
  }
  return null;
}

export function workspaceModelsForProfileReferences(
  refs: ModelProfileReferences,
  catalog: readonly ModelProfileCatalogEntry[] = modelProfileCatalog,
): Omit<WorkspaceConfigureModelsInput, "workspaceId"> | null {
  const author = modelProfileEntryForReference(refs.author, "author", catalog);
  const critic = modelProfileEntryForReference(refs.critic, "critic", catalog);
  if (author === undefined || critic === undefined) return null;
  return {
    authorCompany: author.profile.provider as ModelCompany,
    authorModel: author.profile.modelId,
    criticCompany: critic.profile.provider as ModelCompany,
    criticModel: critic.profile.modelId,
  };
}

export function profileReferencesMatchPreflight(
  refs: ModelProfileReferences,
  preflight: DesktopReviewState["providerTransmissionPreflight"],
  catalog: readonly ModelProfileCatalogEntry[] = modelProfileCatalog,
): boolean {
  const selection = workspaceModelsForProfileReferences(refs, catalog);
  return (
    selection !== null &&
    preflight.author.company === selection.authorCompany &&
    preflight.author.model === selection.authorModel &&
    preflight.critic.company === selection.criticCompany &&
    preflight.critic.model === selection.criticModel
  );
}

/**
 * The preset whose models the workspace already runs, or `null`. A host that keeps no saved pair
 * (the hosted service) still starts the model dialog on that preset rather than an empty custom
 * pair (#1834).
 */
export function presetReferencesMatchingPreflight(
  preflight: DesktopReviewState["providerTransmissionPreflight"],
  catalog: readonly ModelProfileCatalogEntry[] = modelProfileCatalog,
): ModelProfileReferences | null {
  for (const preset of modelProfilePresets) {
    const references = modelProfilePresetReferences(preset);
    if (references !== null && profileReferencesMatchPreflight(references, preflight, catalog)) {
      return references;
    }
  }
  return null;
}

export function reviewActionWithModelProfiles(
  action: ReviewAction,
  refs: ModelProfileReferences | null,
): ReviewAction {
  return action.type === "start" && refs !== null ? { ...action, modelProfiles: refs } : action;
}

/** The reasoning level each role chose, if any. */
export interface ChosenModelProfileLevels {
  readonly author: { readonly effort?: string | undefined };
  readonly critic: { readonly effort?: string | undefined };
}

const effortOrder: readonly string[] = ["low", "medium", "high", "xhigh", "max"];

/**
 * Whether a chosen level is above the profile's own, so the role writes more output tokens than a
 * scenario at the default level assumes. A provider-default profile has no known order.
 */
export function modelProfileEffortRaised(
  reference: {
    readonly id: string;
    readonly version: number;
    readonly effort?: string | undefined;
  },
  role: "author" | "critic",
): boolean {
  if (reference.effort === undefined) return false;
  const own = modelProfileEntryForReference(reference, role)?.profile.runtime.effort;
  const ownRank = own === undefined ? -1 : effortOrder.indexOf(own);
  return ownRank >= 0 && effortOrder.indexOf(reference.effort) > ownRank;
}

/** Whether two pairs name the same exact profiles at the same chosen reasoning levels. */
export function modelProfileSelectionsEqual(
  left: ModelProfileReferences | null,
  right: ModelProfileReferences | null,
): boolean {
  return (
    modelProfileReferencesEqual(left, right) &&
    left?.author.effort === right?.author.effort &&
    left?.critic.effort === right?.critic.effort
  );
}

/** A profile's own reasoning level and the levels a run may choose instead. */
export function modelProfileEffortChoices(
  reference: { readonly id: string; readonly version: number },
  role: "author" | "critic",
): {
  readonly defaultEffort: ModelProfileCatalogEntry["profile"]["runtime"]["effort"];
  readonly levels: readonly ChoosableModelProfileEffort[];
} | null {
  const entry = modelProfileEntryForReference(reference, role);
  if (entry === undefined) return null;
  return {
    defaultEffort: entry.profile.runtime.effort,
    levels: entry.effortLevels.filter(isChoosableModelProfileEffort),
  };
}

/**
 * The chosen levels that differ from each profile's own, such as "writer high", so a preset's name
 * still says where the pair started; empty when both roles use their profile's level.
 */
export function modelProfileLevelSummary(references: ChosenModelProfileLevels): string {
  const parts = (["author", "critic"] as const).flatMap((role) => {
    const effort = references[role].effort;
    if (effort === undefined) return [];
    return [
      `${role === "author" ? "writer" : "reviewer"} ${effortDisplayName(effort).toLowerCase()}`,
    ];
  });
  return parts.join(", ");
}

/** A pair's name with its chosen levels, such as "Balanced · writer high". */
export function withModelProfileLevels(name: string, references: ChosenModelProfileLevels): string {
  const levels = modelProfileLevelSummary(references);
  return levels === "" ? name : `${name} · ${levels}`;
}
