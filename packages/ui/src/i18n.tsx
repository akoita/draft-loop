/**
 * The shared screens' translations (#2321). Every screen string goes through Lingui's catalog:
 * `t` from `@lingui/core/macro` for text and attributes, compiled at build time from
 * `src/locales/<locale>/messages.po`. English is active from the first render, so a screen
 * outside {@link ScreensI18nProvider} still reads its English text.
 *
 * The host picks the locale and passes it to the provider; this module reads no browser or
 * host setting of its own.
 */
import { i18n, type Messages } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { createContext, type ReactNode, useContext, useEffect, useMemo } from "react";
import { messages as englishMessages } from "./locales/en/messages.js";
import { messages as frenchMessages } from "./locales/fr/messages.js";
import { messages as pseudoMessages } from "./locales/pseudo/messages.js";

/** The locales the screens can show; `pseudo` is for development only. */
export const screenLocales = ["en", "fr", "pseudo"] as const;
export type ScreenLocale = (typeof screenLocales)[number];

const catalogs: Readonly<Record<ScreenLocale, Messages>> = {
  en: englishMessages,
  fr: frenchMessages,
  pseudo: pseudoMessages,
};

export function isScreenLocale(value: string): value is ScreenLocale {
  return (screenLocales as readonly string[]).includes(value);
}

/** Makes a locale the active one for every screen string. */
export function activateScreenLocale(locale: ScreenLocale): void {
  if (i18n.locale === locale) return;
  i18n.loadAndActivate({ locale, messages: catalogs[locale] });
}

activateScreenLocale("en");

/**
 * The locale a development host asks for with `?locale=pseudo`; anything else is English. A
 * production host passes its own choice instead.
 */
export function screenLocaleFromSearch(search: string): ScreenLocale {
  const asked = new URLSearchParams(search).get("locale") ?? "";
  return isScreenLocale(asked) ? asked : "en";
}

/** The languages a person can choose for the screens; the pseudo-locale is not one of them. */
export const screenLanguages = ["en", "fr"] as const;
export type ScreenLanguage = (typeof screenLanguages)[number];

export function isScreenLanguage(value: unknown): value is ScreenLanguage {
  return typeof value === "string" && (screenLanguages as readonly string[]).includes(value);
}

/**
 * The screen language to show (#2328): the saved choice, else the first browser or Electron
 * language the screens have, else English. A regional tag such as `fr-CA` counts as its language.
 */
export function negotiateScreenLanguage(
  saved: string | null | undefined,
  preferred: readonly string[],
): ScreenLanguage {
  if (isScreenLanguage(saved)) return saved;
  for (const tag of preferred) {
    const language = tag.toLowerCase().split("-")[0];
    if (isScreenLanguage(language)) return language;
  }
  return "en";
}

interface ScreenLocaleChoice {
  readonly locale: ScreenLocale;
  /** Changes and saves the screen language; absent when the host offers no choice. */
  readonly choose?: (language: ScreenLanguage) => void;
}

const ScreenLocaleContext = createContext<ScreenLocaleChoice>({ locale: "en" });

/** The active screen locale and, when the host offers one, the way to change it. */
export function useScreenLocale(): ScreenLocaleChoice {
  return useContext(ScreenLocaleContext);
}

/**
 * Renders the screens in a locale, re-rendering them when it changes, and marks the page's
 * language for assistive technology and spelling. With `onChoose`, the screens offer the choice.
 */
export function ScreensI18nProvider({
  locale = "en",
  onChoose,
  children,
}: {
  readonly locale?: ScreenLocale;
  readonly onChoose?: (language: ScreenLanguage) => void;
  readonly children: ReactNode;
}) {
  activateScreenLocale(locale);
  useEffect(() => {
    activateScreenLocale(locale);
    if (typeof document !== "undefined") {
      document.documentElement.lang = locale === "pseudo" ? "en" : locale;
    }
  }, [locale]);
  return (
    <I18nProvider i18n={i18n}>
      <ScreenLocaleContext.Provider
        value={onChoose === undefined ? { locale } : { locale, choose: onChoose }}
      >
        {children}
      </ScreenLocaleContext.Provider>
    </I18nProvider>
  );
}

/**
 * Passes each choice the screens make on to `onChoose` as well, such as a signed-in member's saved
 * setting on the server. A choice made outside it, such as applying that saved setting, is not.
 */
export function ScreenLanguageChoiceListener({
  onChoose,
  children,
}: {
  readonly onChoose: (language: ScreenLanguage) => void;
  readonly children: ReactNode;
}) {
  const { locale, choose } = useScreenLocale();
  const value = useMemo<ScreenLocaleChoice>(
    () =>
      choose === undefined
        ? { locale }
        : {
            locale,
            choose: (language) => {
              choose(language);
              onChoose(language);
            },
          },
    [locale, choose, onChoose],
  );
  return <ScreenLocaleContext.Provider value={value}>{children}</ScreenLocaleContext.Provider>;
}
