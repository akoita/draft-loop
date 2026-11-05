/**
 * Which remembered owner token each server window may read (threat model S-021, #2148). The
 * client checks the server's proof before every top-level page load of the window, a reload
 * included, not only when the window opens. A process that takes the address after the window
 * opened, while the real stack is down, so reads no token on its next page load.
 */

export interface TokenOfferOptions {
  /** The token the keychain remembers for a server, or null. */
  readonly remembered: (origin: string) => string | null;
  /** True only when the server at `origin` proves it holds `token`. */
  readonly proves: (origin: string, token: string) => Promise<boolean>;
}

export interface TokenOffers {
  /**
   * Checks the server again before a page of the window loads. The candidate is the remembered
   * token, or the one the person signed in with in this window when nothing is remembered, such
   * as on Linux without a keyring. Until the check ends the window is offered nothing.
   */
  prepare(contentsId: number, origin: string): Promise<void>;
  /** The token the window's page may read: one its server proved it holds, or null. */
  offered(contentsId: number): string | null;
  /** The person signed in on the window's server themselves. */
  signedIn(contentsId: number, token: string): void;
  /** The person signed out, or the server refused the token. */
  forgotten(contentsId: number): void;
  closed(contentsId: number): void;
}

export function createTokenOffers(options: TokenOfferOptions): TokenOffers {
  const offered = new Map<number, string | null>();
  /** The token the person signed in with in each window, kept for the next proof. */
  const signedIn = new Map<number, string>();
  /** The newest check of each window, so an older one that ends late changes nothing. */
  const checks = new Map<number, number>();
  let nextCheck = 0;

  return {
    async prepare(contentsId, origin) {
      const check = ++nextCheck;
      checks.set(contentsId, check);
      offered.set(contentsId, null);
      const candidate = options.remembered(origin) ?? signedIn.get(contentsId) ?? null;
      if (candidate === null) return;
      let proven = false;
      try {
        proven = await options.proves(origin, candidate);
      } catch {
        proven = false;
      }
      if (checks.get(contentsId) === check) offered.set(contentsId, proven ? candidate : null);
    },
    offered: (contentsId) => offered.get(contentsId) ?? null,
    signedIn(contentsId, token) {
      signedIn.set(contentsId, token);
      offered.set(contentsId, token);
    },
    forgotten(contentsId) {
      signedIn.delete(contentsId);
      offered.set(contentsId, null);
    },
    closed(contentsId) {
      offered.delete(contentsId);
      signedIn.delete(contentsId);
      checks.delete(contentsId);
    },
  };
}
