import { t } from "@lingui/core/macro";

import { runEndedBeforeApproval } from "./application-run-order.js";

/**
 * What the review screen says when its run has no draft and is not working on one (#3226): the
 * banner, the Next line and the footer all read this, so they name the same way on. A run that
 * stopped or ran out of budget needs a new review; a paused one resumes; anything else (an
 * interrupted step, a run not started) resumes or retries.
 */
export interface NoDraftGuidance {
  readonly kind: "ended" | "paused" | "retry";
  /** The banner's bold label. */
  readonly label: string;
  /** The banner's sentence: why there is no draft and what to do. */
  readonly detail: string;
  /** The panel's "Next:" line. */
  readonly next: string;
}

export function noDraftGuidance(runState: string): NoDraftGuidance {
  if (runEndedBeforeApproval(runState)) {
    return {
      kind: "ended",
      label: t`No draft: this review stopped`,
      detail: t`This review stopped before it wrote a draft. Start a new review from Run details.`,
      next: t`Next: start a new review from Run details`,
    };
  }
  if (runState === "paused") {
    return {
      kind: "paused",
      label: t`No draft yet: the review is paused`,
      detail: t`Resume the review from Run details to get a draft.`,
      next: t`Next: resume the review`,
    };
  }
  return {
    kind: "retry",
    label: t`No draft yet`,
    detail: t`The review has not written a draft yet. Resume or retry it from Run details.`,
    next: t`Next: resume or start a review to get a draft`,
  };
}
