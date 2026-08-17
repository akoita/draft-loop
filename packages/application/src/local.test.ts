import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openSqliteStorage } from "@draft-loop/storage";
import { describe, expect, it } from "vitest";

import {
  createLocalApplicationDriver,
  defaultRequiredSections,
  SourceIngestionUserError,
} from "./local.js";

describe("local application driver", () => {
  it("fails closed before indexing when PDF extraction is unreliable", async () => {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-invalid-pdf-"));
    try {
      await mkdir(join(root, "evidence"), { recursive: true });
      await writeFile(join(root, "job.md"), "TypeScript systems engineer\n", "utf8");
      await writeFile(
        join(root, "evidence", "resume.pdf"),
        "%PDF-1.4\n1 0 obj\n<< /Length 64 >>\nstream\nBT\n(Caf\\303\\251) Tj\nET\nendstream\nendobj\n%%EOF",
        "utf8",
      );
      const driver = createLocalApplicationDriver();
      await driver.initialize(
        { root, jobDescription: "job.md", sources: "evidence", fixtureMode: true },
        { write: () => undefined },
      );

      const start = driver.start({ root, allowProviderData: false }, { write: () => undefined });
      await expect(start).rejects.toBeInstanceOf(SourceIngestionUserError);
      await expect(start).rejects.toMatchObject({
        name: "SourceIngestionUserError",
        message:
          'The source file "resume.pdf" could not be used. Try another supported text-bearing file or export.',
      });
      await expect(stat(join(root, ".draft-loop", "history.sqlite"))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses the low-cost cross-provider validation pair for new workspaces", async () => {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-default-models-"));
    try {
      await mkdir(join(root, "evidence"), { recursive: true });
      await writeFile(join(root, "job.md"), "TypeScript systems engineer\n", "utf8");
      const driver = createLocalApplicationDriver();

      const workspace = await driver.initialize(
        { root, jobDescription: "job.md", sources: "evidence" },
        { write: () => undefined },
      );

      expect(workspace.author).toEqual({ company: "anthropic", model: "claude-sonnet-4-5" });
      expect(workspace.critic).toEqual({ company: "openai", model: "gpt-5.6-luna" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("lets the candidate widen the required sections explicitly", async () => {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-required-sections-"));
    try {
      await mkdir(join(root, "evidence"), { recursive: true });
      await writeFile(join(root, "job.md"), "TypeScript systems engineer\n", "utf8");
      const driver = createLocalApplicationDriver();

      const workspace = await driver.initialize(
        {
          root,
          jobDescription: "job.md",
          sources: "evidence",
          requiredSections: ["Summary", "Experience", "Education", "Skills"],
        },
        { write: () => undefined },
      );

      expect(workspace.requiredSections).toEqual(["Summary", "Experience", "Education", "Skills"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps the documented default when the candidate does not choose", async () => {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-narrow-sections-"));
    try {
      await mkdir(join(root, "evidence"), { recursive: true });
      await writeFile(join(root, "job.md"), "TypeScript systems engineer\n", "utf8");
      const driver = createLocalApplicationDriver();

      const workspace = await driver.initialize(
        { root, jobDescription: "job.md", sources: "evidence" },
        { write: () => undefined },
      );

      expect(workspace.requiredSections).toEqual([...defaultRequiredSections]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

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
