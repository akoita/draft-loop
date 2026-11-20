/**
 * The links the service emails carry their secret after `#`, so no server sees it:
 * - an invite (`/#invite=CODE`): the screen keeps the code in the tab's session storage through
 *   the sign-in round trip, fills it in on the sign-up screen and forgets it once the account
 *   exists;
 * - a waitlist confirmation (`/#waitlist-confirm=TOKEN`): the landing page posts the token once;
 * - the end of an invite's choose-a-password page (`/#welcome`, no secret): the screen goes
 *   straight on to sign-in, and sign-up finds the invite by the verified email.
 */

const inviteKey = "draft-loop.invite-code";

/** The code an address's fragment carries, or undefined. */
export function inviteCodeFromHash(hash: string): string | undefined {
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const code = params.get("invite")?.trim() ?? "";
  return /^[A-Za-z0-9-]{4,64}$/u.test(code) ? code : undefined;
}

/** Keeps a link's code for this tab; a storage that refuses keeps nothing. */
export function keepInviteCode(storage: Storage | undefined, code: string): void {
  try {
    storage?.setItem(inviteKey, code);
  } catch {
    // Private windows may refuse storage: the person types the code from the email instead.
  }
}

/** The code a link left for this tab, or undefined. */
export function keptInviteCode(storage: Storage | undefined): string | undefined {
  try {
    return storage?.getItem(inviteKey) ?? undefined;
  } catch {
    return undefined;
  }
}

export function forgetInviteCode(storage: Storage | undefined): void {
  try {
    storage?.removeItem(inviteKey);
  } catch {
    // Nothing kept, nothing to forget.
  }
}

/** The token a waitlist confirmation link's fragment carries (`#waitlist-confirm=TOKEN`). */
export function waitlistConfirmTokenFromHash(hash: string): string | undefined {
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const token = params.get("waitlist-confirm")?.trim() ?? "";
  return /^[A-Za-z0-9_-]{16,128}$/u.test(token) ? token : undefined;
}

/** Whether the address is the invite's return from choosing a password (`#welcome`). */
export function welcomeFromHash(hash: string): boolean {
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  return params.has("welcome");
}
