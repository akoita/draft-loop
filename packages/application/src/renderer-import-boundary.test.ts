import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceDirectory = dirname(fileURLToPath(import.meta.url));

// Application modules imported at runtime by the desktop renderer (apps/desktop/src/*.tsx).
const rendererEntries = [
  "model-profile-budget.ts",
  "model-profile-catalog.ts",
  "model-profile-selection.ts",
  "model-profiles.ts",
];

const importPattern = /(?:import|export)\s+(?!type\b)(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']/gu;

function runtimeImportClosure(entries: readonly string[]): Map<string, string[]> {
  const visited = new Map<string, string[]>();
  const pending = entries.map((entry) => resolve(sourceDirectory, entry));
  while (pending.length > 0) {
    const file = pending.pop() as string;
    if (visited.has(file)) continue;
    const specifiers = [...readFileSync(file, "utf8").matchAll(importPattern)].map(
      (match) => match[1] as string,
    );
    visited.set(file, specifiers);
    for (const specifier of specifiers) {
      if (specifier.startsWith("./")) {
        pending.push(resolve(dirname(file), specifier.replace(/\.js$/u, ".ts")));
      }
    }
  }
  return visited;
}

describe("desktop renderer import boundary", () => {
  it("never loads the providers package entry, which pulls in SDKs and Node-only code", () => {
    const offenders = [...runtimeImportClosure(rendererEntries)]
      .filter(([, specifiers]) => specifiers.includes("@draft-loop/providers"))
      .map(([file]) => file.slice(sourceDirectory.length + 1));

    expect(offenders).toEqual([]);
  });
});
