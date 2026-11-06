import { defineConfig } from "@lingui/cli";
import { formatter } from "@lingui/format-po";

/**
 * The shared screens' message catalogs (#2321, ADR 0012). English is the source; `pseudo` is a
 * development locale that shows which strings still bypass the catalog.
 */
export default defineConfig({
  sourceLocale: "en",
  locales: ["en", "pseudo"],
  pseudoLocale: "pseudo",
  fallbackLocales: { default: "en" },
  catalogs: [
    {
      path: "<rootDir>/packages/ui/src/locales/{locale}/messages",
      include: ["<rootDir>/packages/ui/src", "<rootDir>/apps/web/src"],
      exclude: ["**/*.test.ts", "**/*.test.tsx", "**/node_modules/**"],
    },
  ],
  format: formatter({ lineNumbers: false }),
  compileNamespace: "ts",
});
