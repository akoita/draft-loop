import {
  isScreenLanguage,
  negotiateScreenLanguage,
  type ScreenLanguage,
  type ScreenLocale,
  screenLocaleFromSearch,
} from "@draft-loop/ui/i18n";

/** Where this browser, or the desktop client's window, keeps the screen language. */
export const screenLanguageKey = "draft-loop.screen-language";

/**
 * The desktop client's screen language hook (#2329): the language chosen on any server, so each
 * server's screens and the app's own menus agree. Absent in a browser.
 */
export interface DesktopScreenLanguage {
  readonly current: string | null;
  choose(language: ScreenLanguage): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The desktop's screen language hook, when the page runs in the desktop app. */
export function desktopScreenLanguage(
  scope: unknown = globalThis,
): DesktopScreenLanguage | undefined {
  if (!isRecord(scope)) return undefined;
  const host = scope.draftLoopDesktop;
  if (!isRecord(host) || host.host !== "desktop" || !isRecord(host.screenLanguage)) {
    return undefined;
  }
  const { current, choose } = host.screenLanguage;
  if (typeof choose !== "function") return undefined;
  return {
    current: typeof current === "string" ? current : null,
    choose: (language) => choose(language),
  };
}

export interface ScreenLanguageSources {
  readonly storage: () => Storage | undefined;
  /** The desktop client's choice, used when this server's page has saved none. */
  readonly desktop?: DesktopScreenLanguage | undefined;
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
  return negotiateScreenLanguage(
    savedLanguage(sources.storage) ?? sources.desktop?.current,
    sources.languages,
  );
}

/** Saves the choice for the next visit; a browser that refuses storage keeps it for this visit. */
export function saveScreenLanguage(
  storage: () => Storage | undefined,
  language: ScreenLanguage,
  desktop?: DesktopScreenLanguage,
): void {
  desktop?.choose(language);
  try {
    storage()?.setItem(screenLanguageKey, language);
  } catch {
    // Private windows and blocked site data: the choice still applies until the page closes.
  }
}
