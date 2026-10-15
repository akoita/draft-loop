import type { ModelProfileReferences } from "@draft-loop/application/model-profile-selection";

import type { RunEvidenceModeView } from "./run-evidence-mode.js";

/**
 * The `review.preview-evidence` bridge contract: what evidence a run started now would send,
 * asked for when the start confirmation opens instead of on every review load or action.
 *
 * The preview has the shape of the decision a started run records, so the host reuses the
 * recorded-mode validator for it and only modes, counts and the fallback reason cross the bridge.
 */

/** Binds a runtime key list to its interface so a missing or extra key is a compile error. */
function exactKeys<Shape extends object>() {
  return <const Keys extends readonly (keyof Shape & string)[]>(
    keys: Keys & {
      readonly [Key in Exclude<keyof Shape, Keys[number]>]: "add this key to the runtime key list";
    },
  ): Keys => keys;
}

export interface ReviewEvidencePreviewInput {
  readonly workspaceId: string;
  readonly applicationId?: string;
  /** The pair the start would send; an application with its own pair uses that one instead. */
  readonly modelProfiles?: ModelProfileReferences;
}

export interface ReviewEvidencePreviewResult {
  /** `null` when there is no knowledge selection or the preview cannot be worked out. */
  readonly preview: RunEvidenceModeView | null;
}

export const reviewEvidencePreviewKeys = exactKeys<ReviewEvidencePreviewInput>()([
  "workspaceId",
  "applicationId",
  "modelProfiles",
]);

export const reviewEvidencePreviewResultKeys = exactKeys<ReviewEvidencePreviewResult>()([
  "preview",
]);

/** What the start confirmation knows of the preview: still asking, or the answer. */
export type StartEvidencePreview =
  | { readonly status: "checking" }
  | { readonly status: "ready"; readonly preview: RunEvidenceModeView };
