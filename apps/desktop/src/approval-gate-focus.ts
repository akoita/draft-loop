import { useCallback, useEffect, useRef, useState } from "react";

import type { ApprovalReadiness } from "./approval-readiness.js";

/** The review footer's one-line blocker, the place a refused approval sends the reviewer. */
export const approvalBlockerId = "approval-blocker";

/**
 * True when an approval attempt cannot go through because the final CV checks block it, so the
 * footer's blocker line, its Details and its override are what the reviewer needs to see.
 */
export function approvalAttemptNeedsGate(
  readiness: ApprovalReadiness | null,
  approval: "pending" | "approved" | "rejected",
): boolean {
  return readiness?.applicationReady === false && approval !== "approved";
}

/** Scrolls the footer's blocker line into view and focuses it so screen readers announce it. */
export function focusApprovalGate(documentRef: Document = document): boolean {
  const blocker = documentRef.getElementById(approvalBlockerId);
  if (blocker === null) return false;
  blocker.scrollIntoView({ behavior: "smooth", block: "nearest" });
  blocker.focus({ preventScroll: true });
  return true;
}

/**
 * Brings the footer's blocker into view, with its Details opened through `expandGate`, when an
 * approval is refused because the draft is not ready: at once when the footer already says so,
 * or when the host answers an approval with a not-ready draft.
 * A successful approval leaves focus where it was.
 */
export function useApprovalGateFocus<State>({
  state,
  needsGate,
  pending,
  expandGate,
}: {
  readonly state: State;
  readonly needsGate: boolean;
  readonly pending: boolean;
  readonly expandGate: () => void;
}): { readonly revealGate: () => void; readonly attemptApproval: () => void } {
  const [focusRequest, setFocusRequest] = useState(0);
  const attemptState = useRef<{ readonly state: State } | null>(null);

  const revealGate = useCallback(() => {
    expandGate();
    setFocusRequest((current) => current + 1);
  }, [expandGate]);

  const attemptApproval = useCallback(() => {
    if (needsGate) {
      attemptState.current = null;
      revealGate();
    } else {
      attemptState.current = { state };
    }
  }, [needsGate, revealGate, state]);

  // The host answers a refused approval with the refreshed run, whose readiness now blocks it.
  // An attempt that settles without a new run (a thrown error) is simply forgotten.
  const wasPending = useRef(pending);
  useEffect(() => {
    const settled = wasPending.current && !pending;
    wasPending.current = pending;
    const attempt = attemptState.current;
    if (attempt === null || pending || (attempt.state === state && !settled)) return;
    attemptState.current = null;
    if (attempt.state !== state && needsGate) revealGate();
  }, [needsGate, pending, revealGate, state]);

  useEffect(() => {
    if (focusRequest === 0) return;
    // After the opened Details are laid out, and after any dialog has handed focus back.
    const frame = window.requestAnimationFrame(() => focusApprovalGate());
    return () => window.cancelAnimationFrame(frame);
  }, [focusRequest]);

  return { revealGate, attemptApproval };
}
