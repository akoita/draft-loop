import { t } from "@lingui/core/macro";

import type { ApplicationMaterialDraft } from "./application-material-model.js";

/**
 * A cover letter written entirely by a model can be spotted, by recruiters and by AI-detection
 * tools, and it can count against the application (#3277). These helpers decide when the panel
 * warns, asks the candidate to accept that risk, and labels a draft as the model's.
 */

/**
 * True for a cover letter whose text is still the model's: drafted, or revised by the critic, and
 * not one item rewritten by the candidate.
 */
export function isUneditedModelLetter(draft: ApplicationMaterialDraft): boolean {
  if (draft.kind !== "cover-letter") return false;
  if (draft.items.some((item) => item.edited === true)) return false;
  // A critic revision is based on the first draft but still written by a model.
  return draft.based_on === undefined || draft.critic_findings !== undefined;
}

const riskKey = (applicationId: string) => `draft-loop.cover-letter-risk.${applicationId}`;

/** Whether the candidate accepted the risk of a full model letter for this application. */
export function readLetterRiskAccepted(applicationId: string): boolean {
  try {
    return globalThis.localStorage?.getItem(riskKey(applicationId)) === "accepted";
  } catch {
    return false;
  }
}

/** Remembers the choice in this browser; a browser that keeps nothing asks again next time. */
export function saveLetterRiskAccepted(applicationId: string): void {
  try {
    globalThis.localStorage?.setItem(riskKey(applicationId), "accepted");
  } catch {
    // Storage refused: the choice lasts for this page only.
  }
}

/** The question asked before a model letter nobody rewrote leaves the app. */
export function letterExportQuestion(): string {
  return t`This letter is still the AI draft. Sent as it is, it can be spotted and can count against you. Download it anyway?`;
}
