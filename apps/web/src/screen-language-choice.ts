import {
  isScreenLanguage,
  negotiateScreenLanguage,
  type ScreenLanguage,
  type ScreenLocale,
  screenLocaleFromSearch,
} from "@draft-loop/ui/i18n";

/** Where this browser, or the desktop client's window, keeps the screen language. */
export const screenLanguageKey = "draft-loop.screen-language";

export interface ScreenLanguageSources {
  readonly storage: () => Storage | undefined;
  readonly languages: readonly string[];
  readonly search: string;
  /** Development builds also take `?locale=pseudo` or `?locale=fr` from the address. */
  readonly development: boolean;
}

function savedLanguage(storage: () => Storage | undefined): ScreenLanguage | null {
  try {
    const value = storage()?.getItem(screenLanguageKey) ?? null;
    return isScreenLanguage(value) ? value : null;
  } catch {
    return null;
  }
}

/** The locale the screens start in: the address in development, the saved choice, the browser's. */
export function initialScreenLocale(sources: ScreenLanguageSources): ScreenLocale {
  if (sources.development && new URLSearchParams(sources.search).has("locale")) {
    return screenLocaleFromSearch(sources.search);
  }
  return negotiateScreenLanguage(savedLanguage(sources.storage), sources.languages);
}

/** Saves the choice for the next visit; a browser that refuses storage keeps it for this visit. */
export function saveScreenLanguage(
  storage: () => Storage | undefined,
  language: ScreenLanguage,
): void {
  try {
    storage()?.setItem(screenLanguageKey, language);
  } catch {
    // Private windows and blocked site data: the choice still applies until the page closes.
  }
}
