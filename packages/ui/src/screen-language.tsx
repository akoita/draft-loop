import { t } from "@lingui/core/macro";
import { useId } from "react";
import { type ScreenLanguage, screenLanguages, useScreenLocale } from "./i18n.js";

/** Each language by its own name, the same in every screen language, so it stays out of the catalog. */
const screenLanguageNames: Readonly<Record<ScreenLanguage, string>> = {
  en: "English",
  fr: "Français",
};

/**
 * Workspace settings' screen language choice (#2328). It changes menus, buttons and messages only:
 * documents keep the language chosen for them. Renders nothing when the host offers no choice.
 */
export function ScreenLanguageSetting() {
  const { locale, choose } = useScreenLocale();
  const id = useId();
  if (choose === undefined) return null;
  const value: ScreenLanguage = locale === "fr" ? "fr" : "en";
  return (
    <div className="screen-language">
      <label htmlFor={id}>{t`Screen language`}</label>{" "}
      <select
        id={id}
        value={value}
        onChange={(event) => choose(event.target.value === "fr" ? "fr" : "en")}
      >
        {screenLanguages.map((language) => (
          <option key={language} value={language} lang={language}>
            {screenLanguageNames[language]}
          </option>
        ))}
      </select>
      <p className="subtle">
        {t`Menus, buttons and messages use this language. Each CV and letter keeps its own document language.`}
      </p>
    </div>
  );
}

/**
 * The compact screen language control in a page header (#2772): a globe and the language's own
 * name, on every screen from sign-in on, so a new person never needs a record to change it.
 * Renders nothing when the host offers no choice.
 */
export function ScreenLanguageMenu() {
  const { locale, choose } = useScreenLocale();
  if (choose === undefined) return null;
  const value: ScreenLanguage = locale === "fr" ? "fr" : "en";
  const hint = t`Menus, buttons and messages use this language. Each CV and letter keeps its own document language.`;
  return (
    <label className="button button-toolbar screen-language-menu" title={hint}>
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="8.2" stroke="currentColor" strokeWidth="1.6" />
        <path
          d="M3.8 12h16.4M12 3.8c2.3 2.3 3.4 5 3.4 8.2s-1.1 5.9-3.4 8.2c-2.3-2.3-3.4-5-3.4-8.2s1.1-5.9 3.4-8.2Z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </svg>
      <span className="sr-only">{t`Screen language`}</span>
      <select value={value} onChange={(event) => choose(event.target.value === "fr" ? "fr" : "en")}>
        {screenLanguages.map((language) => (
          <option key={language} value={language} lang={language}>
            {screenLanguageNames[language]}
          </option>
        ))}
      </select>
    </label>
  );
}
