/**
 * Whether this browser has opened a Redakloop account before. The signed-out landing page uses it
 * to greet a returning member with Sign in and fold the waitlist away. It holds only a flag, never
 * an email or a token, and it stays after sign-out; deleting the account clears it.
 */
export const returningMemberKey = "draft-loop.has-account";

const lasting = (): Storage | undefined => globalThis.localStorage;

/** True when a signed-in call reached an account from this browser before. */
export function isReturningMember(storage: () => Storage | undefined = lasting): boolean {
  try {
    return storage()?.getItem(returningMemberKey) === "1";
  } catch {
    // Storage refused: the page shows the waitlist as for any visitor.
    return false;
  }
}

/** Notes that this browser reached an account. */
export function rememberMember(storage: () => Storage | undefined = lasting): void {
  try {
    storage()?.setItem(returningMemberKey, "1");
  } catch {
    // Storage refused: the landing page keeps showing the waitlist.
  }
}

/** Forgets the note, once the account is deleted. */
export function forgetMember(storage: () => Storage | undefined = lasting): void {
  try {
    storage()?.removeItem(returningMemberKey);
  } catch {
    // Storage refused: nothing was kept.
  }
}
