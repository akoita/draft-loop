import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { ApplicationLanguageControl } from "./application-language.js";
import {
  activateScreenLocale,
  isScreenLocale,
  rerenderedChildren,
  ScreensI18nProvider,
  screenLocaleFromSearch,
} from "./i18n.js";
import { formatDate, formatList } from "./locale-format.js";
import { providerAuthenticationSummary } from "./provider-authentication-summary.js";

const control = (
  <ApplicationLanguageControl language={null} disabled={false} onSave={async () => undefined} />
);

describe("the screens' locale", () => {
  afterEach(() => activateScreenLocale("en"));

  it("renders the English catalog by default and the pseudo-locale when the host asks", () => {
    expect(renderToStaticMarkup(control)).toContain("Write its documents in");
    const pseudo = renderToStaticMarkup(
      <ScreensI18nProvider locale="pseudo">{control}</ScreensI18nProvider>,
    );
    expect(pseudo).not.toContain("Write its documents in");
    expect(pseudo).toContain("Ŵŕĩţē ĩţś ďōćũḿēńţś ĩń");
  });

  it("hands the screens on as new elements, so a locale change re-renders text already shown", () => {
    const screen = <ApplicationLanguageControl key="screen" {...control.props} />;
    const [again, text] = rerenderedChildren([screen, "plain"]) as [typeof screen, string];
    expect(again).not.toBe(screen);
    expect(again.type).toBe(screen.type);
    expect(again.props).toEqual(screen.props);
    expect(text).toBe("plain");
    expect(rerenderedChildren(null)).toBeNull();
  });

  it("takes the pseudo-locale from the address and anything else as English", () => {
    expect(screenLocaleFromSearch("?locale=pseudo")).toBe("pseudo");
    expect(screenLocaleFromSearch("?locale=xx")).toBe("en");
    expect(screenLocaleFromSearch("")).toBe("en");
    expect(isScreenLocale("en")).toBe(true);
    expect(isScreenLocale("fr")).toBe(true);
    expect(isScreenLocale("de")).toBe(false);
  });

  it("renders key screens in French, and formats dates and lists the French way", () => {
    const french = (node: React.ReactNode) =>
      renderToStaticMarkup(<ScreensI18nProvider locale="fr">{node}</ScreensI18nProvider>);
    expect(french(control)).toContain("Rédiger ses documents en");
    activateScreenLocale("fr");
    expect(
      providerAuthenticationSummary({
        fixtureMode: true,
        anthropicConfigured: false,
        openaiConfigured: false,
        anthropicMode: "api-key",
        openaiMode: "api-key",
      }),
    ).toBe("Mode démo (aucune authentification de fournisseur requise)");
    expect(formatDate("2026-11-24T12:00:00Z", { timeZone: "UTC" })).toBe("24 nov. 2026");
    expect(formatList(["Anthropic", "OpenAI"])).toBe("Anthropic et OpenAI");
  });
});
