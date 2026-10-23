import { describe, expect, it } from "vitest";

import { createTokenStore, ownerTokenProblem } from "./session.js";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  };
}

const token = "synthetic-owner-token-0123456789abcdef";

describe("token store", () => {
  it("keeps the token in session storage until it is cleared", () => {
    const storage = memoryStorage();
    const store = createTokenStore(() => storage);

    store.write(token);
    expect(createTokenStore(() => storage).read()).toBe(token);

    store.clear();
    expect(store.read()).toBeNull();
  });

  it("falls back to memory when storage refuses access", () => {
    const store = createTokenStore(() => {
      throw new Error("blocked");
    });

    store.write(token);
    expect(store.read()).toBe(token);
  });
});

describe("owner token check", () => {
  it("accepts a long token with no whitespace", () => {
    expect(ownerTokenProblem(token)).toBeUndefined();
  });

  it.each([
    ["", "Paste the owner token."],
    ["short", "The owner token is at least 32 characters long."],
    [`${token} more`, "The owner token has no spaces or line breaks."],
  ])("explains why %j is refused", (value, problem) => {
    expect(ownerTokenProblem(value)).toBe(problem);
  });
});
