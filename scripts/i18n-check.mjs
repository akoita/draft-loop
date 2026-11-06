#!/usr/bin/env node
/**
 * The screens' catalog gate (#2321): the PO catalogs hold every message the code uses, no locale
 * misses a translation, and the committed compiled catalogs match the PO files.
 */
import { execFileSync } from "node:child_process";
import console from "node:console";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const localesDir = join(rootDir, "packages/ui/src/locales");
const lingui = join(rootDir, "node_modules/.bin/lingui");

function compiledCatalogs() {
  return Object.fromEntries(
    readdirSync(localesDir).map((locale) => {
      const file = join(localesDir, locale, "messages.ts");
      return [locale, readFileSync(file, "utf8")];
    }),
  );
}

const run = (...args) => execFileSync(lingui, args, { cwd: rootDir, stdio: "inherit" });

run("check", "sync");
run("check", "missing");
const before = compiledCatalogs();
run("compile", "--strict", "--typescript");
const after = compiledCatalogs();
const stale = Object.keys(after).filter((locale) => before[locale] !== after[locale]);
if (stale.length > 0) {
  console.error(
    `The compiled catalogs for ${stale.join(", ")} were out of date; commit the recompiled files.`,
  );
  process.exit(1);
}
