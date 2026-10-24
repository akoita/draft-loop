import type { DesktopReviewState } from "@draft-loop/ui/model";
import { workspaceModelSettingsDraft } from "./workspace-model-settings.js";

/** Merge the loaded workspace's actual destinations over any stale editor draft. */
export function workspaceModelEditorDraftFromState<Draft extends object>(
  existingDraft: Draft,
  loadedWorkspace: DesktopReviewState,
): Draft & ReturnType<typeof workspaceModelSettingsDraft> {
  return { ...existingDraft, ...workspaceModelSettingsDraft(loadedWorkspace) };
}
