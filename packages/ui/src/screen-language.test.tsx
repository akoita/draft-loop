import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { activateScreenLocale, negotiateScreenLanguage, ScreensI18nProvider } from "./i18n.js";
import { ScreenLanguageSetting } from "./screen-language.js";

describe("the screen language", () => {
  afterEach(() => activateScreenLocale("en"));

  it("takes the saved choice, else the first language the screens have, else English", () => {
    expect(negotiateScreenLanguage("fr", ["en-GB"])).toBe("fr");
    expect(negotiateScreenLanguage(null, ["de-DE", "fr-CA", "en"])).toBe("fr");
    expect(negotiateScreenLanguage("pseudo", ["EN-us"])).toBe("en");
    expect(negotiateScreenLanguage(undefined, ["de", "it"])).toBe("en");
    expect(negotiateScreenLanguage(null, [])).toBe("en");
  });

  it("offers the choice in Workspace settings only when the host saves it", () => {
    expect(renderToStaticMarkup(<ScreenLanguageSetting />)).toBe("");
    const english = renderToStaticMarkup(
      <ScreensI18nProvider locale="en" onChoose={() => undefined}>
        <ScreenLanguageSetting />
      </ScreensI18nProvider>,
    );
    expect(english).toContain("Screen language");
    expect(english).toContain('<option value="fr" lang="fr">Français</option>');
    const french = renderToStaticMarkup(
      <ScreensI18nProvider locale="fr" onChoose={() => undefined}>
        <ScreenLanguageSetting />
      </ScreensI18nProvider>,
    );
    expect(french).toContain("Langue de l’interface");
    expect(french).toContain('<option value="fr" lang="fr" selected="">Français</option>');
  });
});
