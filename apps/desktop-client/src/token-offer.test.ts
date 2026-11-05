import { describe, expect, it } from "vitest";

import { createTokenOffers } from "./token-offer.js";

const origin = "http://127.0.0.1:8080";
const token = "owner-token-for-tests-0123456789abcdef";

/** A keychain and an address whose answering server can change between page loads. */
function setup(remembered: string | null = token) {
  const state = { holder: token as string | undefined, keychain: remembered, proofs: 0 };
  const offers = createTokenOffers({
    remembered: () => state.keychain,
    proves: async (_origin, candidate) => {
      state.proofs += 1;
      return state.holder === candidate;
    },
  });
  return { state, offers };
}

describe("token offers", () => {
  it("offers the remembered token to the server that proves it holds it", async () => {
    const { offers } = setup();
    await offers.prepare(1, origin);
    expect(offers.offered(1)).toBe(token);
  });

  it("offers nothing on a reload once another process answers on the address", async () => {
    const { state, offers } = setup();
    await offers.prepare(1, origin);
    state.holder = undefined;
    await offers.prepare(1, origin);
    expect(offers.offered(1)).toBeNull();
    expect(state.proofs).toBe(2);
    // The real server returns: the next page load proves it and gets the token again.
    state.holder = token;
    await offers.prepare(1, origin);
    expect(offers.offered(1)).toBe(token);
  });

  it("offers nothing while a check runs, and ignores a check overtaken by a newer one", async () => {
    let release: (proven: boolean) => void = () => {};
    const offers = createTokenOffers({
      remembered: () => token,
      proves: () =>
        new Promise<boolean>((resolve) => {
          release = resolve;
        }),
    });
    const slow = offers.prepare(1, origin);
    expect(offers.offered(1)).toBeNull();
    const releaseSlow = release;
    const fresh = offers.prepare(1, origin);
    release(false);
    await fresh;
    releaseSlow(true);
    await slow;
    expect(offers.offered(1)).toBeNull();
  });

  it("re-proves the token the person signed in with when the keychain remembers none", async () => {
    const { state, offers } = setup(null);
    await offers.prepare(1, origin);
    expect(offers.offered(1)).toBeNull();
    expect(state.proofs).toBe(0);
    offers.signedIn(1, token);
    expect(offers.offered(1)).toBe(token);
    state.holder = "another-token-0123456789abcdefghijkl";
    await offers.prepare(1, origin);
    expect(offers.offered(1)).toBeNull();
  });

  it("treats a failed proof as no proof, and forgets a window's token on sign-out and close", async () => {
    const offers = createTokenOffers({
      remembered: () => token,
      proves: async () => {
        throw new Error("network");
      },
    });
    await offers.prepare(1, origin);
    expect(offers.offered(1)).toBeNull();
    offers.signedIn(2, token);
    offers.forgotten(2);
    expect(offers.offered(2)).toBeNull();
    offers.signedIn(3, token);
    offers.closed(3);
    expect(offers.offered(3)).toBeNull();
  });
});
