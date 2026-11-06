import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(sourceDirectory, "../../..");
/** Server code that loads shared screen modules at runtime, with no Lingui macro build step. */
const serverDirectories = ["packages/review-state/src", "apps/api/src", "apps/worker/src"];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/u.test(entry.name) && !/\.test\.tsx?$/u.test(entry.name) ? [path] : [];
  });
}

const runtimeImport =
  /^(?:import|export)\s+(?!type\b)([^;]*?)from\s+"((?:@draft-loop\/ui\/|\.\/)[a-z0-9-]+)(?:\.js)?"/gmu;

function onlyTypes(clause: string): boolean {
  const names = /^\s*\{([^}]*)\}/u.exec(clause)?.[1];
  if (names === undefined) return false;
  const entries = names
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "");
  return entries.length > 0 && entries.every((name) => name.startsWith("type "));
}

function uiModule(specifier: string, from: string): string | undefined {
  const base = specifier.startsWith("@draft-loop/ui/")
    ? join(sourceDirectory, specifier.slice("@draft-loop/ui/".length))
    : join(dirname(from), specifier.slice(2));
  return [`${base}.ts`, `${base}.tsx`].find((path) => existsSync(path));
}

/** The shared screen modules the server loads, directly or through other shared modules. */
function serverSharedModules(): Set<string> {
  const seen = new Set<string>();
  const pending: string[] = [];
  const follow = (file: string, uiOnly: boolean) => {
    for (const match of readFileSync(file, "utf8").matchAll(runtimeImport)) {
      const [, clause = "", specifier = ""] = match;
      if (onlyTypes(clause)) continue;
      if (uiOnly && !specifier.startsWith("@draft-loop/ui/")) continue;
      const module = uiModule(specifier, file);
      if (module !== undefined && module.startsWith(sourceDirectory)) pending.push(module);
    }
  };
  for (const directory of serverDirectories) {
    for (const file of sourceFiles(join(repositoryRoot, directory))) follow(file, true);
  }
  while (pending.length > 0) {
    const module = pending.pop() as string;
    if (seen.has(module)) continue;
    seen.add(module);
    follow(module, false);
  }
  return seen;
}

describe("shared modules the server loads", () => {
  it("use no Lingui macro, since the server runs them without the macro build step", () => {
    const modules = [...serverSharedModules()];
    expect(modules.length).toBeGreaterThan(0);
    const withMacro = modules.filter((module) =>
      readFileSync(module, "utf8").includes("@lingui/core/macro"),
    );
    expect(withMacro).toEqual([]);
  });
});
