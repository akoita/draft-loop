/* global document, navigator, window */
// Keeps the about page in the visitor's language, using the same saved choice as the app
// (see apps/web/src/screen-language-choice.ts). A file of its own because the CSP forbids
// inline scripts.
(() => {
  const key = "draft-loop.screen-language";
  const pages = { en: "/about/", fr: "/about/fr/" };
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
  if (wanted !== current) {
    window.location.replace(pages[wanted] + window.location.hash);
  }
})();
