import { describe, expect, it } from "vitest";
import {
  applicationListPreferencesKey,
  defaultApplicationListPreferences,
  readApplicationListPreferences,
  writeApplicationListPreferences,
} from "./home-list-preferences.js";

function memoryStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
  };
}

describe("applications list preferences", () => {
  it("round-trips the view and sort", () => {
    const storage = memoryStorage();
    writeApplicationListPreferences(storage, { view: "list", sort: "name" });
    expect(storage.items.get(applicationListPreferencesKey)).toBe('{"view":"list","sort":"name"}');
    expect(readApplicationListPreferences(storage)).toEqual({ view: "list", sort: "name" });
  });

  it("reads defaults when storage is missing, empty or malformed", () => {
    expect(readApplicationListPreferences(undefined)).toEqual(defaultApplicationListPreferences);
    expect(readApplicationListPreferences(memoryStorage())).toEqual(
      defaultApplicationListPreferences,
    );
    expect(
      readApplicationListPreferences(memoryStorage({ [applicationListPreferencesKey]: "{oops" })),
    ).toEqual(defaultApplicationListPreferences);
  });

  it("keeps a valid field when the other one is unknown", () => {
    const storage = memoryStorage({
      [applicationListPreferencesKey]: '{"view":"tiles","sort":"created"}',
    });
    expect(readApplicationListPreferences(storage)).toEqual({ view: "cards", sort: "created" });
  });

  it("ignores a store that throws", () => {
    const blocked = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(readApplicationListPreferences(blocked)).toEqual(defaultApplicationListPreferences);
    expect(() =>
      writeApplicationListPreferences(blocked, { view: "list", sort: "status" }),
    ).not.toThrow();
  });
});
