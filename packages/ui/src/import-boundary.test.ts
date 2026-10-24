import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceDirectory = dirname(fileURLToPath(import.meta.url));

/**
 * What the shared screens may load at runtime: they run in the desktop renderer and in the
 * browser, so never Electron, Node built-ins, a provider SDK or a server package. Type-only
 * imports are erased and may name any workspace package.
 */
const allowedRuntimeImports: readonly RegExp[] = [
  /^\.\/[a-z0-9-]+\.js$/u,
  /^react(?:-dom)?(?:\/.*)?$/u,
  /^@draft-loop\/domain(?:\/[a-z-]+)?$/u,
  /^@draft-loop\/application\/model-profile-(?:budget|catalog|selection)$/u,
  /^@draft-loop\/application\/model-profiles$/u,
];

const importPattern = /(?:import|export)\s+(?!type\b)(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']/gu;

/** `import { type A, type B } from "x"` is erased as well. */
function onlyTypeNames(statement: string): boolean {
  const names = /^(?:import|export)\s*\{([^}]*)\}/u.exec(statement)?.[1];
  if (names === undefined) return false;
  const entries = names
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  return entries.length > 0 && entries.every((name) => name.startsWith("type "));
}

function runtimeImports(source: string): string[] {
  return [...source.matchAll(importPattern)]
    .filter((match) => !onlyTypeNames(match[0]))
    .map((match) => match[1] as string);
}

describe("shared UI import boundary", () => {
  it("loads only the domain, pure catalog data and its own modules at runtime", () => {
    const offenders = readdirSync(sourceDirectory)
      .filter((file) => /\.tsx?$/u.test(file) && !/\.test\.tsx?$/u.test(file))
      .flatMap((file) =>
        runtimeImports(readFileSync(join(sourceDirectory, file), "utf8"))
          .filter((specifier) => !allowedRuntimeImports.some((allowed) => allowed.test(specifier)))
          .map((specifier) => `${file}: ${specifier}`),
      );

    expect(offenders).toEqual([]);
  });

  it("recognises a forbidden runtime import and ignores a type-only one", () => {
    expect(runtimeImports('import { app } from "electron";')).toEqual(["electron"]);
    expect(runtimeImports('import type { Section } from "@draft-loop/artifacts";')).toEqual([]);
    expect(runtimeImports('import { type A, type B } from "@draft-loop/storage";')).toEqual([]);
    expect(runtimeImports('import { type A, b } from "node:fs";')).toEqual(["node:fs"]);
  });
});
