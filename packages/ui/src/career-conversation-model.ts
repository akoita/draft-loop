/**
 * The request to start career evidence from a conversation (#2734). The Career evidence card and
 * Home ask for it; the career interview panel, which a host mounts elsewhere on the page, answers.
 * A request made before the panel exists waits for it, so Home can ask and then open the page.
 */

let waiting = false;
const listeners = new Set<() => void>();

/** Asks the career interview panel to come into view and start, now or once it is shown. */
export function requestCareerConversation(): void {
  waiting = true;
  for (const listener of [...listeners]) listener();
}

/** True once per request: the panel that takes it answers it. */
export function takeCareerConversationRequest(): boolean {
  const had = waiting;
  waiting = false;
  return had;
}

/** Calls `listener` on each request while the panel is shown; returns the unsubscribe. */
export function onCareerConversationRequest(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** What the panel does with a request: nothing to start while a conversation is already open. */
export function careerConversationRequestStarts(
  session: { readonly status: "open" | "paused" | "closed" } | undefined,
): boolean {
  return session === undefined || session.status !== "open";
}
