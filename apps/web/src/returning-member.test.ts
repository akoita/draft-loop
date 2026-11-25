import { describe, expect, it } from "vitest";

import {
  forgetMember,
  isReturningMember,
  rememberMember,
  returningMemberKey,
} from "./returning-member.js";

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

describe("the returning-member note", () => {
  it("keeps only a flag, and forgets it when the account is deleted", () => {
    const storage = memoryStorage();
    expect(isReturningMember(() => storage)).toBe(false);

    rememberMember(() => storage);
    expect(isReturningMember(() => storage)).toBe(true);
    expect(storage.getItem(returningMemberKey)).toBe("1");

    forgetMember(() => storage);
    expect(isReturningMember(() => storage)).toBe(false);
  });

  it("treats refused storage as a new visitor", () => {
    const refused = () => {
      throw new Error("blocked");
    };
    expect(isReturningMember(refused)).toBe(false);
    expect(() => rememberMember(refused)).not.toThrow();
    expect(() => forgetMember(refused)).not.toThrow();
  });
});
