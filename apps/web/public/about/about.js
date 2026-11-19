/* global document, navigator, window, URL */
// Keeps a public page (the about page, the user guide) in the visitor's language, using the
// same saved choice as the app (see apps/web/src/screen-language-choice.ts). Each language's
// address comes from the page's hreflang links. A file of its own because the CSP forbids
// inline scripts.
(() => {
  const key = "draft-loop.screen-language";
  const pages = {};
  for (const link of document.querySelectorAll('link[rel="alternate"][hreflang]')) {
    const tag = link.getAttribute("hreflang");
    if (tag === "en" || tag === "fr") pages[tag] = new URL(link.href).pathname;
  }
  const current = document.documentElement.lang === "fr" ? "fr" : "en";

  const read = () => {
    try {
      const value = window.localStorage.getItem(key);
      return value === "en" || value === "fr" ? value : null;
    } catch {
      return null;
    }
  };

  const browserLanguage = () => {
    for (const tag of navigator.languages ?? [navigator.language]) {
      const base = String(tag).toLowerCase().split("-")[0];
      if (base === "en" || base === "fr") return base;
    }
    return "en";
  };

  for (const link of document.querySelectorAll("a[data-lang]")) {
    link.addEventListener("click", () => {
      try {
        window.localStorage.setItem(key, link.dataset.lang);
      } catch {
        // Storage can be blocked; the link still opens the other language.
      }
    });
  }

  // A saved choice wins on either page. Without one, only the default English address
  // follows the browser, so a shared French link stays French.
  const wanted = read() ?? (current === "en" ? browserLanguage() : current);
  if (wanted !== current && pages[wanted] !== undefined) {
    window.location.replace(pages[wanted] + window.location.hash);
  }
})();
