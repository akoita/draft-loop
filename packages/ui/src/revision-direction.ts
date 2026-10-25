/**
 * The candidate's short direction for the author, sent with Request revision.
 *
 * It steers selection, emphasis and framing for the next round. It is the person's instruction,
 * not career evidence: grounding still applies, so a direction cannot add a fact that the
 * approved evidence does not hold. The bound matches the application's.
 */
export const maximumRevisionDirectionLength = 1_000;

/** Shown in place of the usual note when the run's recorded author prompt cannot take directions. */
export const revisionDirectionsUnavailableNote =
  "Directions need a review started with the current author prompt. Start a new review to use them.";

/** The `request-revision` action for the typed text: no direction field when it is blank. */
export function requestRevisionAction(
  direction: string,
):
  | { readonly type: "request-revision" }
  | { readonly type: "request-revision"; readonly candidateDirection: string } {
  const candidateDirection = direction.trim();
  return candidateDirection === ""
    ? { type: "request-revision" }
    : { type: "request-revision", candidateDirection };
}

/** Request the revision with the typed directions, then clear the field. */
export function sendRevisionRequest(
  direction: string,
  send: (action: ReturnType<typeof requestRevisionAction>) => void,
  clear: () => void,
): void {
  send(requestRevisionAction(direction));
  clear();
}
