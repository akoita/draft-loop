import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  applyResolvedTheme,
  createThemeStore,
  isThemePreference,
  nextThemePreference,
  readStoredThemePreference,
  resolveTheme,
  ThemeToggle,
  themePreferenceLabel,
  themePreferences,
  themeStorageKey,
  writeStoredThemePreference,
} from "./theme.js";

describe("desk theme preference", () => {
  it("cycles system to light to dark and back to system", () => {
    expect(nextThemePreference("system")).toBe("light");
    expect(nextThemePreference("light")).toBe("dark");
    expect(nextThemePreference("dark")).toBe("system");
    expect(themePreferences).toEqual(["system", "light", "dark"]);
  });

  it("rejects values that are not a preference", () => {
    expect(isThemePreference(null)).toBe(false);
    expect(isThemePreference(undefined)).toBe(false);
    expect(isThemePreference(1)).toBe(false);
    expect(isThemePreference("System")).toBe(false);
    expect(isThemePreference("sepia")).toBe(false);
    for (const preference of themePreferences) expect(isThemePreference(preference)).toBe(true);
  });

  it("defers to the operating system only while following it", () => {
    expect(resolveTheme("system", true)).toBe("light");
    expect(resolveTheme("system", false)).toBe("dark");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("light", false)).toBe("light");
    expect(resolveTheme("dark", true)).toBe("dark");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("falls back to following the system for every unusable stored value", () => {
    expect(readStoredThemePreference()).toBe("system");
    expect(readStoredThemePreference(undefined)).toBe("system");
    expect(readStoredThemePreference({ getItem: () => null })).toBe("system");
    expect(readStoredThemePreference({ getItem: () => "sepia" })).toBe("system");
    expect(
      readStoredThemePreference({
        getItem: () => {
          throw new Error("site data is blocked");
        },
      }),
    ).toBe("system");
  });

  it("reads back a stored preference under the published key", () => {
    const reads: string[] = [];
    const stored = readStoredThemePreference({
      getItem: (key) => {
        reads.push(key);
        return "dark";
      },
    });

    expect(stored).toBe("dark");
    expect(reads).toEqual([themeStorageKey]);
  });

  it("survives a store that refuses the write", () => {
    const written: Array<readonly [string, string]> = [];
    writeStoredThemePreference(
      { setItem: (key, value) => void written.push([key, value]) },
      "light",
    );
    expect(written).toEqual([[themeStorageKey, "light"]]);

    expect(() => writeStoredThemePreference(undefined, "light")).not.toThrow();
    expect(() =>
      writeStoredThemePreference(
        {
          setItem: () => {
            throw new Error("quota exceeded");
          },
        },
        "dark",
      ),
    ).not.toThrow();
  });

  it("writes the resolved desk onto the document root", () => {
    // The desktop suite runs on the Vitest `node` environment, so the root is stubbed rather
    // than pulling a DOM implementation in for one attribute.
    const attributes = new Map<string, string>();
    const root = {
      setAttribute: (name: string, value: string) => void attributes.set(name, value),
    } as unknown as HTMLElement;

    applyResolvedTheme(root, "light");
    expect(attributes.get("data-theme")).toBe("light");
    applyResolvedTheme(root, "dark");
    expect(attributes.get("data-theme")).toBe("dark");
  });

  it("labels each preference for the reader", () => {
    expect(themePreferenceLabel("system")).toBe("Follow system");
    expect(themePreferenceLabel("light")).toBe("Light");
    expect(themePreferenceLabel("dark")).toBe("Dark");
  });

  it("names the current mode and the next one on the control", () => {
    const html = renderToStaticMarkup(<ThemeToggle />);

    expect(html).toContain('<button class="rail-button" type="button"');
    expect(html).toContain("Theme: Follow system. Activate to switch to Light.");
    expect(html).toContain('<span class="sr-only">');
    expect(html).toContain('aria-hidden="true"');
  });

  it("accepts a caller-supplied class", () => {
    const html = renderToStaticMarkup(<ThemeToggle className="boot-theme-toggle" />);

    expect(html).toContain('class="boot-theme-toggle"');
  });

  describe("the document's shared preference", () => {
    function fixture(stored: string | null = null, prefersLight = false) {
      const values = new Map<string, string>();
      if (stored !== null) values.set(themeStorageKey, stored);
      const storage = {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => void values.set(key, value),
      };
      const attributes = new Map<string, string>();
      const root = {
        setAttribute: (name: string, value: string) => void attributes.set(name, value),
      } as unknown as HTMLElement;
      const handlers = new Map<string, (event: unknown) => void>();
      const target = {
        addEventListener: (type: string, handler: (event: unknown) => void) =>
          void handlers.set(type, handler),
        removeEventListener: (type: string) => void handlers.delete(type),
      };
      const query = { matches: prefersLight, ...target } as unknown as MediaQueryList;
      const events = target as unknown as Window;
      const store = createThemeStore(storage, root, query, events);
      return { store, values, attributes, handlers, query };
    }

    it("gives every mounted control the same choice, so a hidden page cannot keep an old one", () => {
      const { store, attributes } = fixture("system", true);
      const seen: string[] = [];
      const offHome = store.subscribe(() => seen.push(`home:${store.get()}`));
      const offReview = store.subscribe(() => seen.push(`review:${store.get()}`));

      store.set("dark");

      expect(seen).toEqual(["home:dark", "review:dark"]);
      expect(attributes.get("data-theme")).toBe("dark");
      offHome();
      offReview();
    });

    it("saves the choice and takes up one another tab writes", () => {
      const { store, values, attributes, handlers } = fixture("light");
      const off = store.subscribe(() => undefined);
      store.set("dark");
      expect(values.get(themeStorageKey)).toBe("dark");

      values.set(themeStorageKey, "light");
      handlers.get("storage")?.({ key: themeStorageKey });
      expect(store.get()).toBe("light");
      expect(attributes.get("data-theme")).toBe("light");
      off();
      expect(handlers.size).toBe(0);
    });

    it("follows the operating system only while the choice is system", () => {
      const { store, attributes, handlers, query } = fixture("system", false);
      const off = store.subscribe(() => undefined);
      (query as { matches: boolean }).matches = true;
      handlers.get("change")?.({});
      expect(attributes.get("data-theme")).toBe("light");

      store.set("dark");
      (query as { matches: boolean }).matches = false;
      handlers.get("change")?.({});
      (query as { matches: boolean }).matches = true;
      handlers.get("change")?.({});
      expect(attributes.get("data-theme")).toBe("dark");
      off();
    });
  });
});
