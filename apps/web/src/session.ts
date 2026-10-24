/** The API's rule for the owner token (ADR 0011, phase 1): long, with no whitespace. */
export const ownerTokenMinimumLength = 32;

const storageKey = "draft-loop.owner-token";

/** Where the screen keeps a credential for the tab's lifetime. */
export interface TokenStore {
  read(): string | null;
  write(token: string): void;
  clear(): void;
}

/**
 * Keeps the token in the tab's session storage, so it is gone when the tab closes. Storage can be
 * missing or refuse access in a private window; the screen then keeps the token in memory only.
 * `key` names the entry; the owner token's is the default.
 */
export function createTokenStore(
  storage: () => Storage | undefined,
  key: string = storageKey,
): TokenStore {
  let memory: string | null = null;
  return {
    read() {
      try {
        return storage()?.getItem(key) ?? memory;
      } catch {
        return memory;
      }
    },
    write(token) {
      memory = token;
      try {
        storage()?.setItem(key, token);
      } catch {
        // Memory still holds it.
      }
    },
    clear() {
      memory = null;
      try {
        storage()?.removeItem(key);
      } catch {
        // Nothing stored.
      }
    },
  };
}

/** Why a pasted token cannot be the owner token, or `undefined` when it can. */
export function ownerTokenProblem(token: string): string | undefined {
  if (token.length === 0) return "Paste the owner token.";
  if (/\s/u.test(token)) return "The owner token has no spaces or line breaks.";
  if (token.length < ownerTokenMinimumLength)
    return `The owner token is at least ${ownerTokenMinimumLength} characters long.`;
  return undefined;
}
