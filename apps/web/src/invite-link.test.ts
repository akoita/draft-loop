import { describe, expect, it } from "vitest";

import {
  forgetInviteCode,
  inviteCodeFromHash,
  keepInviteCode,
  keptInviteCode,
  waitlistConfirmTokenFromHash,
} from "./invite-link.js";

function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, value),
  };
}

describe("the invite link", () => {
  it("reads the code after #invite= and nothing else", () => {
    expect(inviteCodeFromHash("#invite=ABCD2345EFGH6789")).toBe("ABCD2345EFGH6789");
    expect(inviteCodeFromHash("")).toBeUndefined();
    expect(inviteCodeFromHash("#invite=")).toBeUndefined();
    expect(inviteCodeFromHash("#invite=<script>")).toBeUndefined();
  });

  it("keeps the code for the tab until it is forgotten", () => {
    const storage = memoryStorage();
    keepInviteCode(storage, "ABCD2345EFGH6789");
    expect(keptInviteCode(storage)).toBe("ABCD2345EFGH6789");
    forgetInviteCode(storage);
    expect(keptInviteCode(storage)).toBeUndefined();
  });

  it("works without storage", () => {
    keepInviteCode(undefined, "ABCD2345EFGH6789");
    expect(keptInviteCode(undefined)).toBeUndefined();
  });
});

describe("the waitlist confirmation link", () => {
  it("reads the token after #waitlist-confirm= and nothing else", () => {
    expect(waitlistConfirmTokenFromHash("#waitlist-confirm=abcdefABCDEF0123_-xy")).toBe(
      "abcdefABCDEF0123_-xy",
    );
    expect(waitlistConfirmTokenFromHash("#invite=ABCD2345EFGH6789")).toBeUndefined();
    expect(waitlistConfirmTokenFromHash("#waitlist-confirm=short")).toBeUndefined();
  });
});
