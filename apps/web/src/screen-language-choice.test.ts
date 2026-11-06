import { describe, expect, it } from "vitest";
import {
  initialScreenLocale,
  saveScreenLanguage,
  screenLanguageKey,
} from "./screen-language-choice.js";

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial));
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

const base = { languages: ["en-GB"], search: "", development: false };

describe("the web screen language", () => {
  it("starts in the saved language, else the browser's, else English", () => {
    const saved = memoryStorage({ [screenLanguageKey]: "fr" });
    expect(initialScreenLocale({ ...base, storage: () => saved })).toBe("fr");
    const empty = memoryStorage();
    expect(initialScreenLocale({ ...base, storage: () => empty, languages: ["fr-FR"] })).toBe("fr");
    const unknown = memoryStorage({ [screenLanguageKey]: "klingon" });
    expect(initialScreenLocale({ ...base, storage: () => unknown, languages: ["de"] })).toBe("en");
  });

  it("takes the address only in development builds", () => {
    const empty = memoryStorage();
    const sources = { ...base, storage: () => empty, search: "?locale=pseudo" };
    expect(initialScreenLocale({ ...sources, development: true })).toBe("pseudo");
    expect(initialScreenLocale(sources)).toBe("en");
  });

  it("saves the choice, and survives a browser that refuses storage", () => {
    const storage = memoryStorage();
    saveScreenLanguage(() => storage, "fr");
    expect(storage.getItem(screenLanguageKey)).toBe("fr");
    const refusing = () => {
      throw new Error("blocked");
    };
    expect(() => saveScreenLanguage(refusing, "fr")).not.toThrow();
    expect(initialScreenLocale({ ...base, storage: refusing })).toBe("en");
  });
});
