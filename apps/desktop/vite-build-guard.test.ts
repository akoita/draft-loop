import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { build, type Plugin } from "vite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { viteBuildGuard } from "./vite-build-guard.js";

// Stands in for @electron-forge/plugin-vite, which marks a target as built
// when `closeBundle` runs and as failed only when `buildEnd` sees an error.
function forgeBuildDone(events: string[]): Plugin {
  return {
    name: "forge-build-done",
    buildEnd(error) {
      if (error instanceof Error) {
        events.push("forge:failed");
      }
    },
    closeBundle() {
      events.push("forge:built");
    },
  };
}

describe("viteBuildGuard", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "vite-build-guard-"));
    await writeFile(join(root, "lib.ts"), "export const present = 1;\n");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function buildEntry(source: string, events: string[]): Promise<void> {
    await writeFile(join(root, "main.ts"), source);
    await build({
      configFile: false,
      logLevel: "silent",
      root,
      plugins: [forgeBuildDone(events), viteBuildGuard()],
      build: {
        outDir: join(root, "out"),
        emptyOutDir: true,
        lib: { entry: join(root, "main.ts"), fileName: () => "main.js", formats: ["cjs"] },
      },
    });
  }

  it("rejects with the Vite error before Forge can mark the target built", async () => {
    const events: string[] = [];

    await expect(
      buildEntry('import { absent } from "./lib";\nconsole.log(absent);\n', events),
    ).rejects.toThrow(/MISSING_EXPORT[\s\S]*"absent" is not exported/u);
    expect(events).toEqual([]);
  });

  it("lets a successful build reach Forge's closeBundle", async () => {
    const events: string[] = [];

    await buildEntry('import { present } from "./lib";\nconsole.log(present);\n', events);

    expect(events).toEqual(["forge:built"]);
  });

  it("stays out of watch builds so a rebuild error does not stop the watcher", () => {
    const apply = viteBuildGuard().apply;

    expect(typeof apply).toBe("function");
    if (typeof apply !== "function") return;
    expect(apply({ build: { watch: {} } }, { command: "build", mode: "development" })).toBe(false);
    expect(apply({ build: { watch: null } }, { command: "build", mode: "production" })).toBe(true);
    expect(apply({}, { command: "build", mode: "production" })).toBe(true);
  });
});
