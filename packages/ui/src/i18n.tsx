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
import { type ReactNode, useEffect } from "react";
import { messages as englishMessages } from "./locales/en/messages.js";
import { messages as pseudoMessages } from "./locales/pseudo/messages.js";

/** The locales the screens can show; `pseudo` is for development only. */
export const screenLocales = ["en", "pseudo"] as const;
export type ScreenLocale = (typeof screenLocales)[number];

const catalogs: Readonly<Record<ScreenLocale, Messages>> = {
  en: englishMessages,
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

/** Renders the screens in a locale, re-rendering them when it changes. */
export function ScreensI18nProvider({
  locale = "en",
  children,
}: {
  readonly locale?: ScreenLocale;
  readonly children: ReactNode;
}) {
  activateScreenLocale(locale);
  useEffect(() => activateScreenLocale(locale), [locale]);
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}
