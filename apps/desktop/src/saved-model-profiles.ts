import type { ModelProfileReferences } from "@draft-loop/application/model-profile-selection";

import {
  parseSavedModelProfilesResult,
  type SavedModelProfilesResult,
} from "./model-profile-bridge.js";
import {
  type AppliedModelProfileSelection,
  ModelProfileSaveError,
  modelProfileReferencesEqual,
  type SavedModelProfilesState,
  usableSavedModelProfiles,
} from "./model-profile-picker-state.js";
import type { WorkspaceSetupCapabilities } from "./native.js";

type SavedProfilesPort = Pick<
  WorkspaceSetupCapabilities,
  "readSavedModelProfiles" | "saveModelProfiles"
>;

/** Reads the pair saved for a workspace; a read that fails is reported, never treated as empty. */
export async function loadSavedModelProfilesState(
  port: SavedProfilesPort,
  workspaceId: string,
  generation: number,
): Promise<SavedModelProfilesState> {
  if (port.readSavedModelProfiles === undefined) return { status: "idle" };
  try {
    const result = parseSavedModelProfilesResult(
      await port.readSavedModelProfiles(workspaceId),
      workspaceId,
    );
    return { status: "ready", workspaceId, generation, result };
  } catch {
    return { status: "unavailable", workspaceId, generation };
  }
}

/** The selection a reopened workspace starts from, or null when the saved pair is absent or unusable. */
export function appliedSelectionFromSaved(
  saved: SavedModelProfilesState,
): AppliedModelProfileSelection | null {
  if (saved.status !== "ready") return null;
  const usable = usableSavedModelProfiles(saved.result);
  if (usable === null) return null;
  return {
    workspaceId: saved.workspaceId,
    generation: saved.generation,
    refs: { author: { ...usable.author }, critic: { ...usable.critic } },
  };
}

/**
 * Saves the pair for future runs. A pair that cannot be saved, or that the host reports back as
 * different or ignored, throws `ModelProfileSaveError` so it is never shown as applied.
 */
export async function saveAppliedModelProfiles(
  port: SavedProfilesPort,
  workspaceId: string,
  references: ModelProfileReferences,
): Promise<SavedModelProfilesResult> {
  if (port.saveModelProfiles === undefined) throw new ModelProfileSaveError();
  let saved: SavedModelProfilesResult;
  try {
    saved = parseSavedModelProfilesResult(
      await port.saveModelProfiles(workspaceId, references),
      workspaceId,
    );
  } catch (reason) {
    throw new ModelProfileSaveError(reason instanceof Error ? reason.message : undefined);
  }
  if (
    !modelProfileReferencesEqual(saved.modelProfiles, references) ||
    saved.ignoredReason !== null
  ) {
    throw new ModelProfileSaveError();
  }
  return saved;
}

/** Removes the saved pair after the workspace models were changed by hand. */
export async function clearSavedModelProfiles(
  port: SavedProfilesPort,
  workspaceId: string,
): Promise<SavedModelProfilesResult> {
  if (port.saveModelProfiles === undefined) throw new ModelProfileSaveError();
  return parseSavedModelProfilesResult(
    await port.saveModelProfiles(workspaceId, null),
    workspaceId,
  );
}
