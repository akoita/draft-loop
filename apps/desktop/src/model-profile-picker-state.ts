import {
  listModelProfileCatalog,
  listModelProfilePresets,
  type ModelProfileCatalogEntry,
  type ModelProfilePreset,
} from "@draft-loop/application/model-profile-catalog";
import type { ModelProfileReferences } from "@draft-loop/application/model-profile-selection";
import type {
  ModelCompany,
  ModelProfileSupportResult,
  WorkspaceConfigureModelsInput,
} from "./bridge.js";
import type { DesktopReviewState, ReviewAction } from "./model.js";

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

export function reviewActionWithModelProfiles(
  action: ReviewAction,
  refs: ModelProfileReferences | null,
): ReviewAction {
  return action.type === "start" && refs !== null ? { ...action, modelProfiles: refs } : action;
}
