import { helpGuide, helpSectionIds } from "@draft-loop/user-guide";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HelpButton, HelpDialog } from "./help-panel.js";
import { ScreensI18nProvider } from "./i18n.js";

function render(node: ReactNode, locale: "en" | "fr" = "en"): string {
  return renderToStaticMarkup(<ScreensI18nProvider locale={locale}>{node}</ScreensI18nProvider>);
}

describe("the user guide's text (#2830)", () => {
  it("has every section, in order, in each language", () => {
    for (const locale of ["en", "fr"] as const) {
      const guide = helpGuide(locale);
      expect(guide.sections.map((section) => section.id)).toEqual([...helpSectionIds]);
      expect(guide.intro.trim()).not.toBe("");
      for (const section of guide.sections) {
        expect(section.title.trim()).not.toBe("");
        expect(section.paragraphs.length).toBeGreaterThan(0);
      }
    }
  });

  it("has a French text distinct from the English one", () => {
    const english = helpGuide("en").sections;
    const french = helpGuide("fr").sections;
    english.forEach((section, index) => {
      expect(french[index]?.title).not.toBe(section.title);
      expect(french[index]?.paragraphs.length).toBe(section.paragraphs.length);
    });
  });

  it("names the Display choices and Advanced options", () => {
    const display = helpGuide("en").sections.find((section) => section.id === "display");
    const text = display?.paragraphs.join(" ") ?? "";
    for (const name of ["Guided", "Simple", "Show everything", "Advanced options"]) {
      expect(text).toContain(name);
    }
  });

  it("reads English under the development pseudo-locale", () => {
    expect(helpGuide("pseudo")).toBe(helpGuide("en"));
  });
});

describe("the Help button and its guide (#2830)", () => {
  it("shows a Help button that says it opens a dialog, with no guide until pressed", () => {
    const html = render(<HelpButton />);

    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain("Help");
    expect(html).not.toContain("<dialog");
  });

  it("lists every section as a disclosure, the first one open", () => {
    const html = render(<HelpDialog onClose={() => {}} />);

    expect(html).toMatch(/<dialog[^>]*class="help-dialog"[^>]*aria-labelledby="[^"]+-title"/u);
    expect(html).toContain('closedby="any"');
    expect(html.match(/<details/gu)).toHaveLength(helpSectionIds.length);
    expect(html).toMatch(
      /<details [^>]*class="help-section" open="">\s*<summary>Add your career evidence/u,
    );
    expect(html).toContain("Close");
  });

  it("offers a search field above the sections, with an empty status until the member types", () => {
    const html = render(<HelpDialog onClose={() => {}} />);

    expect(html).toContain('type="search"');
    expect(html).toContain("Search the guide");
    expect(html).toMatch(/<p class="help-search-status" role="status"><\/p>/u);
  });

  it("speaks French when the screen does", () => {
    const html = render(<HelpDialog onClose={() => {}} />, "fr");

    expect(html).toContain("Aide");
    expect(html).toContain("Fermer");
    expect(html).toContain("Ajouter vos éléments de parcours");
    expect(html).not.toContain("Add your career evidence");
  });
});
