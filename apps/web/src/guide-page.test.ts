import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { helpGuide, helpGuideLanguages } from "@draft-loop/user-guide";
import { describe, expect, it } from "vitest";

import { guideImageSizes } from "./guide-images.js";
import {
  escapeHtml,
  guideImageFile,
  guidePageFiles,
  guidePageHtml,
  guidePagePaths,
} from "./guide-page.js";

describe("the public user guide pages", () => {
  it.each(helpGuideLanguages)(
    "shows every section of the %s guide, linked from the contents",
    (language) => {
      const html = guidePageHtml(language);
      const guide = helpGuide(language);

      expect(html).toContain(`<html lang="${language}">`);
      expect(html).toContain(escapeHtml(guide.intro));
      for (const section of guide.sections) {
        expect(html).toContain(`<article class="card guide-section" id="${section.id}">`);
        expect(html).toContain(`<a href="#${section.id}">${escapeHtml(section.title)}</a>`);
        for (const paragraph of section.paragraphs) expect(html).toContain(escapeHtml(paragraph));
      }
    },
  );

  it("marks the current language and links both, with absolute addresses for search engines", () => {
    const html = guidePageHtml("fr");

    expect(html).toContain('<link rel="alternate" hreflang="en" href="__SITE_ORIGIN__/guide/" />');
    expect(html).toContain(
      '<link rel="alternate" hreflang="fr" href="__SITE_ORIGIN__/guide/fr/" />',
    );
    expect(html).toContain('<link rel="canonical" href="__SITE_ORIGIN__/guide/fr/" />');
    expect(html).toContain(
      '<a href="/guide/fr/" lang="fr" aria-current="true" data-lang="fr">FR</a>',
    );
    expect(html).toContain("/legal/fr/privacy");
  });

  it("has no inline script or style, so the content security policy holds", () => {
    for (const language of helpGuideLanguages) {
      const html = guidePageHtml(language);
      expect(html).not.toMatch(/<script(?![^>]*\ssrc=)[^>]*>/u);
      expect(html).not.toMatch(/<style|\sstyle=|\son[a-z]+=/u);
    }
  });

  it("keeps guide text as text", () => {
    expect(escapeHtml(`<b>"Tom" & 'Jo'</b>`)).toBe(
      "&lt;b&gt;&quot;Tom&quot; &amp; &#39;Jo&#39;&lt;/b&gt;",
    );
  });

  it("writes one file per language at its served address", () => {
    expect(guidePageFiles().map(({ fileName }) => `/${fileName}`)).toEqual(
      helpGuideLanguages.map((language) => `${guidePagePaths[language]}index.html`),
    );
  });
});

describe("the public user guide screenshots", () => {
  const imageDirectory = join(dirname(fileURLToPath(import.meta.url)), "../public/guide/images");

  it.each(helpGuideLanguages)(
    "has a sized %s picture for each section that names one",
    (language) => {
      const html = guidePageHtml(language);
      for (const section of helpGuide(language).sections) {
        if (section.screenshot === undefined) continue;
        const file = guideImageFile(section, language);
        expect(existsSync(join(imageDirectory, file)), file).toBe(true);
        expect(guideImageSizes[file], file).toBeDefined();
        expect(html).toContain(
          `src="/guide/images/${file}" alt="${escapeHtml(section.screenshot.alt)}"`,
        );
      }
    },
  );

  it("names a screenshot in both languages or in neither", () => {
    const [english, french] = helpGuideLanguages.map((language) =>
      helpGuide(language).sections.map((section) => section.screenshot !== undefined),
    );
    expect(french).toEqual(english);
  });
});
