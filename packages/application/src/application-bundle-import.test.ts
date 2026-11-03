import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setSqliteCommitSyncSkippedForTests } from "@draft-loop/storage/sqlite-handle";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  bundledApplicationId,
  importApplicationBundle,
  readApplicationBundle,
} from "./application-bundle-import.js";
import { type ApplicationService, createApplicationService } from "./index.js";
import { createLocalApplicationDriver } from "./local.js";
import { setFixtureStepDelayForTests } from "./local-fixture-agents.js";
import { localHistoryPath, openLocalHistoryReadOnly } from "./local-storage-factory.js";
import { importedApplicationId } from "./workspace-application-import.js";
import { noWorkspaceFiles, withWorkspaceFiles } from "./workspace-files.js";

const silent = { write: () => undefined };

describe("application bundles", () => {
  const directories: string[] = [];
  const service: ApplicationService = createApplicationService(createLocalApplicationDriver());
  let fixtureStepDelayMs = 0;
  let commitSyncSkipped = false;

  beforeAll(() => {
    fixtureStepDelayMs = setFixtureStepDelayForTests(0);
    commitSyncSkipped = setSqliteCommitSyncSkippedForTests(true);
  });
  afterAll(() => {
    setFixtureStepDelayForTests(fixtureStepDelayMs);
    setSqliteCommitSyncSkippedForTests(commitSyncSkipped);
  });
  afterEach(async () => {
    await Promise.all(
      directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  async function workspace(job: string): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-bundle-"));
    directories.push(root);
    await mkdir(join(root, "evidence"), { recursive: true });
    await writeFile(join(root, "job.md"), job, "utf8");
    await writeFile(
      join(root, "evidence", "resume.md"),
      "Built fictional local-first tools with deterministic testing.\n",
      "utf8",
    );
    await service.initialize(
      { root, jobDescription: "job.md", sources: "evidence", fixtureMode: true },
      silent,
    );
    return root;
  }

  /** A fictional desktop workspace with a reviewed brief and an approved fixture run. */
  async function desktopWorkspace() {
    const root = await workspace("# Fictional Designer\n\nDesign interfaces.\n");
    const briefId = "brief-bundle";
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
    const workspaceId = (await service.readWorkspace(root)).id;
    const history = openLocalHistoryReadOnly(localHistoryPath(root));
    try {
      const bundle = await readApplicationBundle({
        source: history,
        sourceWorkspaceId: workspaceId,
        sourceApplicationId: "default",
        name: "Fictional Designer",
        jobText: "# Fictional Designer\n\nDesign interfaces.",
      });
      // The bundle crosses HTTP as JSON.
      return {
        root,
        runId: started.runId,
        workspaceId,
        bundle: JSON.parse(JSON.stringify(bundle)),
      };
    } finally {
      await history.close();
    }
  }

  it("imports the application, its brief versions and its run, and answers a resend as done", async () => {
    const desktop = await desktopWorkspace();
    const target = await workspace("# Home Job\n\nBuild tools.\n");

    const imported = await importApplicationBundle({ root: target, bundle: desktop.bundle });

    expect(imported).toMatchObject({
      applicationId: importedApplicationId(desktop.workspaceId),
      name: "Fictional Designer",
      status: "imported",
      counts: { runs: 1, briefs: 1, briefVersions: 3 },
    });
    const [, application] = await service.listApplications({ root: target });
    expect(application?.runs.map((run) => run.id)).toEqual([desktop.runId]);
    expect(application?.briefs).toEqual([
      expect.objectContaining({ briefId: "brief-bundle", latestVersion: 3, status: "reviewed" }),
    ]);
    const status = await service.status({ root: target, runId: desktop.runId }, silent);
    expect(status).toMatchObject({
      runId: desktop.runId,
      state: "approved",
      workspaceId: (await service.readWorkspace(target)).id,
    });
    expect(status?.artifact).not.toBeNull();

    await expect(
      importApplicationBundle({ root: target, bundle: desktop.bundle }),
    ).resolves.toMatchObject({ status: "already-imported", applicationId: imported.applicationId });
  });

  it("keeps the job text in the application's record where the workspace has no files", async () => {
    const desktop = await desktopWorkspace();
    const target = await workspace("# Home Job\n\nBuild tools.\n");

    await withWorkspaceFiles(noWorkspaceFiles, () =>
      importApplicationBundle({ root: target, bundle: desktop.bundle }),
    );

    const [, application] = await service.listApplications({ root: target });
    expect(application?.jobSource).toEqual({
      kind: "stored-text",
      text: "# Fictional Designer\n\nDesign interfaces.",
    });
  });

  it("refuses a run id that the workspace already holds elsewhere, and a malformed bundle", async () => {
    const desktop = await desktopWorkspace();
    const other = {
      ...desktop.bundle,
      sourceApplicationId: "app-other",
      briefs: [],
    };

    await expect(importApplicationBundle({ root: desktop.root, bundle: other })).rejects.toThrow(
      /already holds a run/u,
    );
    await expect(
      importApplicationBundle({ root: desktop.root, bundle: { ...desktop.bundle, format: "x" } }),
    ).rejects.toThrow(/not valid/u);
  });

  it("derives a stable application id per source application", () => {
    expect(bundledApplicationId("ws-1", "default")).toBe(importedApplicationId("ws-1"));
    expect(bundledApplicationId("ws-1", "app-a")).not.toBe(bundledApplicationId("ws-1", "app-b"));
  });
});
