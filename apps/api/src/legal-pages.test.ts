import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import {
  type LegalPageId,
  legalVersion,
  preferredLegalLanguage,
  readLegalPublisher,
  registerLegalPages,
  renderLegalPage,
} from "./legal-pages.js";
import { legalTextsEn } from "./legal-text-en.js";
import { legalTextsFr } from "./legal-text-fr.js";

const publisher = {
  name: "Example Publisher",
  address: "1 rue de l'Exemple, 75000 Paris",
  email: "contact@example.test",
  director: "Example Director",
};

describe("legal pages", () => {
  it("serves each page in English and French, with the publisher filled in and escaped", async () => {
    const app = Fastify();
    registerLegalPages(app, { publisher: { ...publisher, name: "A <b>&</b> B" } });
    for (const page of ["terms", "privacy", "notice"] as const) {
      for (const language of ["en", "fr"] as const) {
        const response = await app.inject({ url: `/legal/${language}/${page}` });
        expect(response.statusCode).toBe(200);
        expect(response.headers["content-type"]).toContain("text/html");
        expect(response.body).toContain(`<html lang="${language}">`);
        expect(response.body).not.toContain("<b>");
        expect(response.body).toContain(legalVersion);
      }
    }
    const notice = await app.inject({ url: "/legal/fr/notice" });
    expect(notice.body).toContain("A &lt;b&gt;&amp;&lt;/b&gt; B");
    expect(notice.body).toContain("contact@example.test");
    // Optional details that are not set leave their line out.
    expect(notice.body).not.toContain("Téléphone");
  });

  it("shows a visible placeholder for each detail a deployment did not set", () => {
    const html = renderLegalPage("notice", "en", undefined);
    expect(html).toContain("Publisher: [to be completed]");
    expect(renderLegalPage("privacy", "fr", undefined)).toContain("[à compléter]");
  });

  it("says the test can stop, that data download is offered first, and names the providers outside the EU", () => {
    for (const [language, phrases] of [
      [
        "en",
        [
          "stop at any time",
          "download your data",
          "Anthropic",
          "OpenAI",
          "outside the European Union",
        ],
      ],
      [
        "fr",
        [
          "s'arrêter à tout moment",
          "télécharger vos données",
          "Anthropic",
          "OpenAI",
          "hors de l'Union européenne",
        ],
      ],
    ] as const) {
      const all = (["terms", "privacy"] as const)
        .map((page) => renderLegalPage(page, language, publisher))
        .join("\n");
      for (const phrase of phrases) expect(all).toContain(phrase.replaceAll("'", "&#39;"));
    }
  });

  it("keeps the same pages and sections in both languages", () => {
    for (const page of Object.keys(legalTextsEn.pages) as LegalPageId[]) {
      expect(legalTextsFr.pages[page].sections.length).toBe(
        legalTextsEn.pages[page].sections.length,
      );
    }
  });

  it("links pages within the reader's language, and sends a bare address to the browser's", async () => {
    expect(renderLegalPage("terms", "fr", publisher)).toContain('href="/legal/fr/privacy"');
    const app = Fastify();
    registerLegalPages(app, {});
    const french = await app.inject({
      url: "/legal/terms",
      headers: { "accept-language": "fr-FR,fr;q=0.9,en;q=0.8" },
    });
    expect(french.statusCode).toBe(302);
    expect(french.headers.location).toBe("/legal/fr/terms");
    expect((await app.inject({ url: "/legal/privacy" })).headers.location).toBe(
      "/legal/en/privacy",
    );
    expect(preferredLegalLanguage("de-DE,fr;q=0.5")).toBe("en");
    const css = await app.inject({ url: "/legal/legal.css" });
    expect(css.headers["content-type"]).toContain("text/css");
  });

  it("reads the publisher from one JSON variable and refuses a malformed one", () => {
    expect(readLegalPublisher({})).toBeUndefined();
    expect(
      readLegalPublisher({
        DRAFT_LOOP_LEGAL_PUBLISHER: JSON.stringify({ ...publisher, phone: " +33 1 00 00 00 00 " }),
      }),
    ).toEqual({ ...publisher, phone: "+33 1 00 00 00 00" });
    for (const value of [
      "not json",
      "[]",
      JSON.stringify({ name: "Only a name" }),
      JSON.stringify({ ...publisher, extra: "x" }),
      JSON.stringify({ ...publisher, email: "" }),
      JSON.stringify({ name: "Example Publisher", email: "contact@example.test" }),
      JSON.stringify({ name: "N", email: "e@example.test", detailsUrl: "http://example.test" }),
      JSON.stringify({ name: "N", email: "e@example.test", detailsUrl: "https://x.test/a)b" }),
    ]) {
      expect(() => readLegalPublisher({ DRAFT_LOOP_LEGAL_PUBLISHER: value })).toThrow(
        /DRAFT_LOOP_LEGAL_PUBLISHER/u,
      );
    }
  });

  it("needs only a name, an email and a link to the company's own details page", () => {
    const minimal = {
      name: "Example Publisher",
      email: "contact@example.test",
      detailsUrl: "https://example.test/legal.html",
    };
    expect(readLegalPublisher({ DRAFT_LOOP_LEGAL_PUBLISHER: JSON.stringify(minimal) })).toEqual(
      minimal,
    );
    for (const [language, page] of [
      ["en", "notice"],
      ["fr", "notice"],
      ["en", "privacy"],
      ["fr", "privacy"],
    ] as const) {
      const html = renderLegalPage(page, language, minimal);
      expect(html).toContain('<a href="https://example.test/legal.html">');
      expect(html).not.toContain("[to be completed]");
      expect(html).not.toContain("[à compléter]");
      expect(html).not.toMatch(/Address|Adresse|Publication director|Directeur/u);
    }
  });
});
