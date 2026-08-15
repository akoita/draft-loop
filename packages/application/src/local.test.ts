import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openSqliteStorage } from "@draft-loop/storage";
import { describe, expect, it } from "vitest";

import { createLocalApplicationDriver } from "./local.js";

describe("local application export history", () => {
  it("returns the newest completed existing export for the requested format", async () => {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-latest-export-"));
    const io = { write: () => undefined };
    try {
      await mkdir(join(root, "evidence"), { recursive: true });
      await writeFile(join(root, "job.md"), "TypeScript systems engineer\n", "utf8");
      await writeFile(join(root, "evidence", "resume.md"), "Candidate evidence\n", "utf8");
      const driver = createLocalApplicationDriver();
      const workspace = await driver.initialize(
        { root, jobDescription: "job.md", sources: "evidence", fixtureMode: true },
        io,
      );
      const snapshot = await driver.start({ root, allowProviderData: false }, io);
      if (snapshot.artifact === null) throw new Error("The fixture did not produce an artifact.");

      const olderPath = join(root, "exports", "older.md");
      const newestPath = join(root, "exports", "newest.md");
      await mkdir(join(root, "exports"), { recursive: true });
      await writeFile(olderPath, "older export\n", "utf8");
      const storage = openSqliteStorage(join(root, ".draft-loop", "history.sqlite"));
      try {
        await storage.saveExport({
          id: "export-older",
          workspaceId: workspace.id,
          runId: snapshot.runId,
          artifactId: snapshot.artifact.id,
          format: "markdown",
          status: "completed",
          outputPath: olderPath,
          outputChecksum: "a".repeat(64),
          createdAt: "2026-08-15T10:00:00.000Z",
          payload: { format: "markdown" },
        });
        await storage.saveExport({
          id: "export-newest-missing",
          workspaceId: workspace.id,
          runId: snapshot.runId,
          artifactId: snapshot.artifact.id,
          format: "markdown",
          status: "completed",
          outputPath: newestPath,
          outputChecksum: "b".repeat(64),
          createdAt: "2026-08-15T10:01:00.000Z",
          payload: { format: "markdown" },
        });
      } finally {
        await storage.close();
      }

      await expect(
        driver.latestExportPath({ root, runId: snapshot.runId, format: "markdown" }),
      ).resolves.toBe(olderPath);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
