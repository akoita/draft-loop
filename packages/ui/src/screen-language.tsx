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
