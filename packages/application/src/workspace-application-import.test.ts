import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { openSqliteStorage } from "@draft-loop/storage";
import { afterEach, describe, expect, it } from "vitest";
import { type ApplicationService, createApplicationService } from "./index.js";
import { createLocalApplicationDriver } from "./local.js";
import {
  importApplicationFromWorkspace,
  importedApplicationId,
} from "./workspace-application-import.js";

const silent = { write: () => undefined };

describe("importing a workspace as an application", () => {
  const directories: string[] = [];
  const service: ApplicationService = createApplicationService(createLocalApplicationDriver());

  afterEach(async () => {
    await Promise.all(
      directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  async function workspace(job: string): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-import-"));
    directories.push(root);
    await mkdir(join(root, "evidence"), { recursive: true });
    await writeFile(join(root, "job.md"), job, "utf8");
    await writeFile(
      join(root, "evidence", "resume.md"),
      "Built local-first TypeScript tools with deterministic testing.\n",
      "utf8",
    );
    await service.initialize(
      { root, jobDescription: "job.md", sources: "evidence", fixtureMode: true },
      silent,
    );
    return root;
  }

  /** A per-job workspace as users made them before applications: a brief, an approved run and an export. */
  async function legacyWorkspace(job: string, briefId: string) {
    const root = await workspace(job);
    const sources = [
      {
        id: "source-1",
        kind: "pasted-content" as const,
        classification: "job-posting" as const,
        content: "Design accessible interfaces for a synthetic product.",
      },
    ];
    await service.createOpportunity({ root, id: briefId, sources });
    await service.editOpportunity({
      root,
      briefId,
      expectedVersion: 1,
      patch: {
        role: { value: "Product Designer", sourceIds: ["source-1"] },
        employer: { value: "Example Systems", sourceIds: ["source-1"] },
        requirements: [
          {
            id: "requirement-1",
            text: "Accessible interface design",
            priority: "critical",
            sourceIds: ["source-1"],
          },
        ],
      },
    });
    await service.reviewOpportunity({ root, briefId, expectedVersion: 2 });
    const started = await service.start(
      { root, opportunityBrief: { briefId, version: 3 }, allowProviderData: false },
      silent,
    );
    await service.lifecycle({ root, action: "revision", runId: started.runId }, silent);
    await service.resume({ root, runId: started.runId }, silent);
    await service.lifecycle({ root, action: "approve", runId: started.runId }, silent);
    const exportPath = await service.export({ root, runId: started.runId }, silent);
    return { root, runId: started.runId, exportPath };
  }

  async function digest(root: string): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    const walk = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) await walk(path);
        else {
          result[relative(root, path)] = createHash("sha256")
            .update(await readFile(path))
            .digest("hex");
        }
      }
    };
    await walk(root);
    return result;
  }

  it("imports the job, brief versions, approved run and export, and leaves the source untouched", async () => {
    const legacy = await legacyWorkspace("# Legacy Designer\n\nDesign interfaces.\n", "brief-hc4");
    const target = await workspace("# Home Job\n\nBuild tools.\n");
    const before = await digest(legacy.root);
    const sourceBrief = await service.getOpportunity({ root: legacy.root, briefId: "brief-hc4" });

    const imported = await service.importApplication?.({ root: target, sourceRoot: legacy.root });

    expect(imported?.counts).toEqual({
      runs: 1,
      briefs: 1,
      briefVersions: 3,
      exports: 1,
      skippedExports: 0,
    });
    expect(imported?.application).toMatchObject({
      id: importedApplicationId((await service.readWorkspace(legacy.root)).id),
      name: "Legacy Designer",
      isDefault: false,
      status: "exported",
      jobSource: { kind: "pasted-text" },
    });
    expect(await digest(legacy.root)).toEqual(before);

    const [home, application] = await service.listApplications({ root: target });
    expect(home).toMatchObject({ id: "default", runs: [], exports: [] });
    expect(application?.runs.map((run) => run.id)).toEqual([legacy.runId]);
    expect(application?.briefs).toEqual([
      expect.objectContaining({ briefId: "brief-hc4", latestVersion: 3, status: "reviewed" }),
    ]);
    expect(application?.exports).toEqual([
      expect.objectContaining({ runId: legacy.runId, status: "completed", format: "markdown" }),
    ]);

    // The job text now lives in this workspace.
    const storedPath =
      application?.jobSource.kind === "pasted-text" ? application.jobSource.storedPath : "";
    expect(await readFile(join(target, storedPath), "utf8")).toContain("Design interfaces.");

    // The run reads as a run of this workspace.
    const status = await service.status({ root: target, runId: legacy.runId }, silent);
    expect(status).toMatchObject({
      runId: legacy.runId,
      state: "exported",
      workspaceId: (await service.readWorkspace(target)).id,
    });
    expect(status?.artifact).not.toBeNull();
    await expect(
      service.readIndependentReview({ root: target, runId: legacy.runId }),
    ).resolves.toBeDefined();

    // The brief keeps its exact versions and checksum.
    const importedBrief = await service.getOpportunity({ root: target, briefId: "brief-hc4" });
    expect(importedBrief?.brief).toEqual(sourceBrief?.brief);
    expect(importedBrief?.checksum).toBe(sourceBrief?.checksum);

    // The export file is available in this workspace and equals the source's.
    const exported = await service.latestExportPath({
      root: target,
      runId: legacy.runId,
      format: "markdown",
    });
    expect(exported).not.toBeNull();
    expect(exported).not.toBe(legacy.exportPath);
    expect(await readFile(exported ?? "", "utf8")).toBe(await readFile(legacy.exportPath, "utf8"));

    // The typed history was copied, so the run's rounds, executions and decisions are there too.
    const storage = openSqliteStorage(join(target, ".draft-loop", "history.sqlite"));
    try {
      expect((await storage.listRounds(legacy.runId)).length).toBeGreaterThan(0);
      expect((await storage.listExecutions(legacy.runId)).length).toBeGreaterThan(0);
      expect(await storage.getRun(legacy.runId)).toMatchObject({
        workspaceId: (await service.readWorkspace(target)).id,
      });
    } finally {
      await storage.close();
    }
  });

  it("refuses to import the same workspace twice and imports a second workspace alongside", async () => {
    const first = await legacyWorkspace("# First Job\n\nDo first things.\n", "brief-first");
    const second = await legacyWorkspace("# Second Job\n\nDo second things.\n", "brief-second");
    const target = await workspace("# Home Job\n\nBuild tools.\n");

    await service.importApplication?.({ root: target, sourceRoot: first.root });
    await expect(
      service.importApplication?.({ root: target, sourceRoot: first.root }),
    ).rejects.toThrow(/already imported as the application "First Job"/u);
    const next = await service.importApplication?.({ root: target, sourceRoot: second.root });

    expect(next?.application.name).toBe("Second Job");
    const applications = await service.listApplications({ root: target });
    expect(applications.map((item) => item.name)).toEqual([
      expect.any(String),
      "First Job",
      "Second Job",
    ]);
    expect(applications[1]?.runs.map((run) => run.id)).toEqual([first.runId]);
    expect(applications[2]?.runs.map((run) => run.id)).toEqual([second.runId]);
  });

  it("names the application from the request, the job heading or the folder", async () => {
    const named = await legacyWorkspace("Plain job text without a heading.\n", "brief-named");
    const target = await workspace("# Home Job\n\nBuild tools.\n");

    await expect(
      service.importApplication?.({ root: target, sourceRoot: named.root, name: "   " }),
    ).rejects.toThrow(/between 1 and 120 characters/u);
    const imported = await service.importApplication?.({
      root: target,
      sourceRoot: named.root,
      name: "  Acme — Designer  ",
    });
    expect(imported?.application.name).toBe("Acme — Designer");

    const unnamed = await workspace("No heading either.\n");
    const folderNamed = await service.importApplication?.({ root: target, sourceRoot: unnamed });
    expect(folderNamed?.application.name).toMatch(/^draft-loop-import-/u);
    expect(folderNamed?.counts).toEqual({
      runs: 0,
      briefs: 0,
      briefVersions: 0,
      exports: 0,
      skippedExports: 0,
    });
    expect(folderNamed?.application.status).toBe("drafting");
  });

  it("refuses a folder that is not a workspace, the workspace itself and a workspace without a job", async () => {
    const target = await workspace("# Home Job\n\nBuild tools.\n");
    const empty = await mkdtemp(join(tmpdir(), "draft-loop-import-empty-"));
    directories.push(empty);

    await expect(service.importApplication?.({ root: target, sourceRoot: empty })).rejects.toThrow(
      /not a DraftLoop workspace/u,
    );
    await expect(
      service.importApplication?.({ root: target, sourceRoot: join(empty, "missing") }),
    ).rejects.toThrow(/not a DraftLoop workspace/u);
    await expect(service.importApplication?.({ root: target, sourceRoot: target })).rejects.toThrow(
      /cannot be imported into itself/u,
    );

    const jobless = await workspace("# Job\n");
    await writeFile(join(jobless, "job.md"), "  \n", "utf8");
    await expect(
      service.importApplication?.({ root: target, sourceRoot: jobless }),
    ).rejects.toThrow(/no job description/u);

    // Nothing was created by any refusal.
    expect((await service.listApplications({ root: target })).map((item) => item.id)).toEqual([
      "default",
    ]);
    await expect(stat(join(target, ".draft-loop", "applications"))).rejects.toThrow();
  });

  it("skips a completed export whose file is gone and says so", async () => {
    const legacy = await legacyWorkspace("# Legacy Job\n\nWork.\n", "brief-gone");
    await rm(legacy.exportPath);
    const target = await workspace("# Home Job\n\nBuild tools.\n");

    const imported = await service.importApplication?.({ root: target, sourceRoot: legacy.root });

    expect(imported?.counts).toMatchObject({ runs: 1, exports: 0, skippedExports: 1 });
    expect(imported?.application.exports).toEqual([]);
    expect(imported?.application.runs.map((run) => run.id)).toEqual([legacy.runId]);
  });

  it("resumes an interrupted import without leaving runs in the default application", async () => {
    const legacy = await legacyWorkspace("# Interrupted Job\n\nWork.\n", "brief-resume");
    const target = await workspace("# Home Job\n\nBuild tools.\n");
    let calls = 0;
    const failing = {
      readWorkspace: async (root: string) => service.readWorkspace(root),
      now: () => {
        calls += 1;
        if (calls === 4) throw new Error("simulated interruption");
        return new Date().toISOString();
      },
    };

    await expect(
      importApplicationFromWorkspace({ root: target, sourceRoot: legacy.root }, failing),
    ).rejects.toThrow(/Run the import again to resume/u);
    const [home, partial] = await service.listApplications({ root: target });
    expect(home?.runs).toEqual([]);
    expect(partial?.runs.map((run) => run.id)).toEqual([legacy.runId]);
    expect(partial?.briefs).toEqual([]);

    const resumed = await service.importApplication?.({ root: target, sourceRoot: legacy.root });

    expect(resumed?.application.id).toBe(partial?.id);
    expect(resumed?.application.runs.map((run) => run.id)).toEqual([legacy.runId]);
    expect(resumed?.application.briefs).toHaveLength(1);
    expect(resumed?.application.exports).toHaveLength(1);
    await expect(
      service.importApplication?.({ root: target, sourceRoot: legacy.root }),
    ).rejects.toThrow(/already imported/u);
  });
});
