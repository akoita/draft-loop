/**
 * The public user guide pages, `/guide/` and `/guide/fr/`: the Help panel's guide
 * (`@draft-loop/user-guide`) as a static page in the about page's look, so a visitor and a search
 * engine can read it without signing in. The build writes them from the same source, so the guide
 * is never copied. No inline style or script, so the content security policy holds.
 */
import { type HelpGuideLanguage, helpGuide, helpGuideLanguages } from "@draft-loop/user-guide";

/** Where each language's guide page is served. */
export const guidePagePaths: Readonly<Record<HelpGuideLanguage, string>> = {
  en: "/guide/",
  fr: "/guide/fr/",
};

/** Where the API writes the site's public origin into a public page. */
export const siteOriginToken = "__SITE_ORIGIN__";

/** The page's own words around the guide, in each language. */
const chrome = {
  en: {
    title: "DraftLoop user guide: how to draft a CV for a job",
    description:
      "How to use DraftLoop: add your career evidence, add a job, run a draft, review and export your CV, prepare for the job, and keep your data private.",
    tag: "[ User guide ]",
    heading: "How to use DraftLoop",
    contents: "Contents",
    language: "Language",
    about: "About",
    guide: "Guide",
    access: "Request access",
    more: "Still stuck? Once you are signed in, select Send feedback in the header and tell us what happened.",
    footer:
      "Tailored CVs and cover letters from your own career documents, checked by a second AI before you approve them.",
    site: "DraftLoop",
    contact: "Contact and legal",
    sample: "Sample screens",
    privacy: "Privacy policy",
    terms: "Terms of use",
    notice: "Legal notice",
    rights: "DraftLoop. All rights reserved.",
    locale: "en_GB",
  },
  fr: {
    title: "Guide d’utilisation de DraftLoop : rédiger un CV pour une offre",
    description:
      "Comment utiliser DraftLoop : ajouter vos éléments de parcours, ajouter une offre, lancer une rédaction, relire et exporter votre CV, préparer l’entretien et protéger vos données.",
    tag: "[ Guide d’utilisation ]",
    heading: "Comment utiliser DraftLoop",
    contents: "Sommaire",
    language: "Langue",
    about: "À propos",
    guide: "Guide",
    access: "Demander un accès",
    more: "Toujours bloqué ? Une fois connecté, sélectionnez Envoyer un avis dans l’en-tête et racontez-nous ce qui s’est passé.",
    footer:
      "Des CV et lettres de motivation adaptés, tirés de vos propres documents de carrière et vérifiés par une seconde IA avant que vous ne les validiez.",
    site: "DraftLoop",
    contact: "Contact et mentions",
    sample: "Exemples d’écrans",
    privacy: "Politique de confidentialité",
    terms: "Conditions d’utilisation",
    notice: "Mentions légales",
    rights: "DraftLoop. Tous droits réservés.",
    locale: "fr_FR",
  },
} as const satisfies Record<HelpGuideLanguage, Record<string, string>>;

const aboutPaths: Readonly<Record<HelpGuideLanguage, string>> = { en: "/about/", fr: "/about/fr/" };

/** The guide's text is plain text; this keeps it plain in the page. */
export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** The whole guide page in one language, as the build writes it. */
export function guidePageHtml(language: HelpGuideLanguage): string {
  const words = chrome[language];
  const guide = helpGuide(language);
  const e = escapeHtml;

  // The API replaces the origin token with the public origin, or with nothing where search
  // indexing is off, so search engines get absolute addresses (apps/api/src/public-site.ts).
  const alternates = helpGuideLanguages
    .map(
      (tag) =>
        `<link rel="alternate" hreflang="${tag}" href="${siteOriginToken}${guidePagePaths[tag]}" />`,
    )
    .concat(
      `<link rel="alternate" hreflang="x-default" href="${siteOriginToken}${guidePagePaths.en}" />`,
    );
  const switcher = helpGuideLanguages.map((tag) => {
    const current = tag === language ? ` aria-current="true"` : "";
    return `<a href="${guidePagePaths[tag]}" lang="${tag}"${current} data-lang="${tag}">${tag.toUpperCase()}</a>`;
  });
  const contents = guide.sections.map(
    (section) => `<li><a href="#${section.id}">${e(section.title)}</a></li>`,
  );
  const sections = guide.sections.map((section, index) =>
    [
      `<article class="card guide-section" id="${section.id}">`,
      `<p class="card-num">${String(index + 1).padStart(2, "0")}</p>`,
      `<h2>${e(section.title)}</h2>`,
      ...section.paragraphs.map((paragraph) => `<p>${e(paragraph)}</p>`),
      `</article>`,
    ].join("\n"),
  );

  return `<!doctype html>
<html lang="${language}">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${e(words.title)}</title>
<meta name="description" content="${e(words.description)}" />
<meta name="theme-color" content="#0f7d6e" />
<meta property="og:title" content="${e(words.title)}" />
<meta property="og:description" content="${e(words.description)}" />
<meta property="og:type" content="article" />
<meta property="og:locale" content="${words.locale}" />
<link rel="canonical" href="${siteOriginToken}${guidePagePaths[language]}" />
<link rel="icon" href="/showcase/mark.svg" type="image/svg+xml" />
${alternates.join("\n")}
<link rel="stylesheet" href="/about/about.css" />
<link rel="stylesheet" href="/guide/guide.css" />
<script src="/about/about.js" defer></script>
</head>
<body>
<header class="top">
<div class="wrap top-row">
<a class="brand" href="${aboutPaths[language]}" aria-label="DraftLoop">
<img src="/showcase/mark.svg" alt="" width="32" height="32" />
<span>DraftLoop</span>
</a>
<nav class="top-nav" aria-label="${e(words.site)}">
<a href="${aboutPaths[language]}">${e(words.about)}</a>
<a href="${guidePagePaths[language]}" aria-current="page">${e(words.guide)}</a>
</nav>
<div class="top-actions">
<nav class="lang" aria-label="${e(words.language)}">
${switcher.join("\n")}
</nav>
<a class="button" href="/#landing-waitlist">${e(words.access)}</a>
</div>
</div>
</header>
<main id="top">
<section class="hero guide-hero">
<div class="wrap">
<p class="tag">${e(words.tag)}</p>
<h1>${e(words.heading)}</h1>
<p class="lead">${e(guide.intro)}</p>
</div>
</section>
<section class="section guide-body">
<div class="wrap guide-grid">
<nav class="guide-contents" aria-labelledby="guide-contents-title">
<p class="guide-contents-title" id="guide-contents-title">${e(words.contents)}</p>
<ol>
${contents.join("\n")}
</ol>
</nav>
<div class="guide-sections">
${sections.join("\n")}
<p class="small">${e(words.more)}</p>
</div>
</div>
</section>
</main>
<footer class="foot">
<div class="wrap foot-grid">
<div>
<p class="foot-brand">DraftLoop</p>
<p>${e(words.footer)}</p>
</div>
<div>
<p class="foot-title">${e(words.site)}</p>
<ul>
<li><a href="${aboutPaths[language]}">${e(words.about)}</a></li>
<li><a href="${guidePagePaths[language]}">${e(words.guide)}</a></li>
<li><a href="/showcase/">${e(words.sample)}</a></li>
</ul>
</div>
<div>
<p class="foot-title">${e(words.contact)}</p>
<ul>
<li><a href="mailto:contact@maya-labs.xyz">contact@maya-labs.xyz</a></li>
<li><a href="/legal/${language}/privacy">${e(words.privacy)}</a></li>
<li><a href="/legal/${language}/terms">${e(words.terms)}</a></li>
<li><a href="/legal/${language}/notice">${e(words.notice)}</a></li>
</ul>
</div>
</div>
<div class="wrap foot-bottom">
<span>${e(words.rights)}</span>
</div>
</footer>
</body>
</html>
`;
}

/** Each guide page's file in the build output, beside the about page. */
export function guidePageFiles(): readonly { readonly fileName: string; readonly html: string }[] {
  return helpGuideLanguages.map((language) => ({
    fileName: `${guidePagePaths[language].slice(1)}index.html`,
    html: guidePageHtml(language),
  }));
}
