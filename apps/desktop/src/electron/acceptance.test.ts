import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { runPackagedAcceptance } from "./acceptance.js";
import { createNativeHost } from "./host.js";

describe("packaged installed-app acceptance workflow", () => {
  it("covers sanitized inputs, preflight, restart, review, and all exports", async () => {
    const parent = await mkdtemp(join(tmpdir(), "draft-loop-installed-acceptance-"));
    const workspaceRoot = join(parent, "workspace");
    const candidatePath = join(parent, "candidate.md");
    const evidencePath = join(parent, "acceptance.json");
    const jobUrl = "https://jobs.example.test/roles/typescript-systems-engineer";
    await writeFile(candidatePath, "Sanitized candidate profile\n", "utf8");

    const createHost = () =>
      createNativeHost({
        requireProviderPreflight: true,
        dialogs: {
          chooseDirectory: async (mode) => (mode === "create" ? parent : workspaceRoot),
          chooseFiles: async (input) => (input.target === "evidence" ? [candidatePath] : []),
        },
        urlFetcher: async () =>
          new Response(
            "<html><body><h1>TypeScript Systems Engineer</h1><p>Build local-first tools with TypeScript and testing.</p></body></html>",
            { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
          ),
        urlHostnameResolver: async () => ["93.184.216.34"],
      });

    try {
      await runPackagedAcceptance({
        host: createHost(),
        phase: "prepare",
        workspaceRoot,
        candidatePath,
        evidencePath,
        appVersion: "test",
        artifactChecksum: "a".repeat(64),
        jobUrl,
      });
      await runPackagedAcceptance({
        host: createHost(),
        phase: "resume",
        workspaceRoot,
        candidatePath,
        evidencePath,
        appVersion: "test",
        artifactChecksum: "a".repeat(64),
        jobUrl,
      });
      const report = JSON.parse(await readFile(evidencePath, "utf8")) as {
        readonly checks: Readonly<Record<string, boolean>>;
      };
      expect(Object.values(report.checks).every(Boolean)).toBe(true);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  }, 10_000);
});
