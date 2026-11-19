import { ScreensI18nProvider } from "@draft-loop/ui/i18n";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { HelpMenuView } from "./help-menu.js";

function render(node: ReactNode, locale: "en" | "fr" = "en"): string {
  return renderToStaticMarkup(<ScreensI18nProvider locale={locale}>{node}</ScreensI18nProvider>);
}

describe("help menu", () => {
  it("groups quick help, the user guide, About, feedback and the legal pages", () => {
    const html = render(<HelpMenuView onQuickHelp={() => {}} onFeedback={() => {}} />);

    expect(html).toMatch(/<summary[^>]*>[\s\S]*Help<\/summary>/u);
    expect(html).toMatch(
      /Quick help<\/button>[\s\S]*User guide<\/a>[\s\S]*About DraftLoop<\/a>[\s\S]*Send feedback<\/button>[\s\S]*Privacy policy/u,
    );
    expect(html).toContain('href="/guide/" target="_blank" rel="noopener">User guide</a>');
    expect(html).toContain('href="/about/" target="_blank" rel="noopener">About DraftLoop</a>');
    expect(html).toContain('<a href="/legal/terms" target="_blank" rel="noopener">');
  });

  it("offers no Send feedback without a way to send it, as in owner-token mode", () => {
    const html = render(<HelpMenuView onQuickHelp={() => {}} />);

    expect(html).not.toContain("Send feedback");
    expect(html).toContain("Quick help");
  });

  it("ends with the server's version and release day when the server names them", () => {
    const release = { version: "0.26.46", releasedOn: "2026-11-19" };
    const html = render(<HelpMenuView onQuickHelp={() => {}} release={release} />);

    expect(html).toMatch(
      /Privacy policy[\s\S]*<p class="help-menu-version">Version 0.26.46 · Released/u,
    );
    expect(html).toContain("2026");
    expect(
      render(<HelpMenuView onQuickHelp={() => {}} release={{ version: "0.26.46" }} />),
    ).toContain('<p class="help-menu-version">Version 0.26.46</p>');
    expect(render(<HelpMenuView onQuickHelp={() => {}} />)).not.toContain("help-menu-version");
  });

  it("speaks French and links the French pages when the screen does", () => {
    const html = render(<HelpMenuView onQuickHelp={() => {}} onFeedback={() => {}} />, "fr");

    expect(html).toContain('href="/guide/fr/"');
    expect(html).toContain('href="/about/fr/"');
    expect(html).toContain("Aide rapide");
  });
});
