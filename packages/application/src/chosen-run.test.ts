import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSqliteStorage } from "@draft-loop/storage";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applicationRunChoiceClearedEventType,
  applicationRunChosenEventType,
  chooseApplicationRun,
  normalizeChosenRunReason,
} from "./chosen-run.js";
import { CliUserError } from "./cli-user-error.js";
import { createApplicationService } from "./index.js";
import { createLocalApplicationDriver } from "./local.js";

const silent = { write: () => undefined };

describe("choosing an application's run", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  async function workspace() {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-chosen-run-"));
    directories.push(root);
    await mkdir(join(root, "evidence"), { recursive: true });
    await writeFile(join(root, "job.md"), "# Synthetic Platform Engineer\n\nBuild tools.\n");
    await writeFile(
      join(root, "evidence", "resume.md"),
      "Built local-first TypeScript tools with deterministic testing.\n",
    );
    const service = createApplicationService(createLocalApplicationDriver());
    await service.initialize(
      { root, jobDescription: "job.md", sources: "evidence", fixtureMode: true },
      silent,
    );
    return { root, service };
  }

  it("uses an earlier run's draft for approval and export, and records the choice", async () => {
    const { root, service } = await workspace();
    const earlier = await service.start({ root, allowProviderData: false }, silent);
    await service.lifecycle({ root, action: "revision", runId: earlier.runId }, silent);
    await service.resume({ root, runId: earlier.runId }, silent);
    const latest = await service.start({ root, allowProviderData: false }, silent);

    const before = await service.getApplication({ root, applicationId: "default" });
    expect(before?.chosenRun).toBeNull();

    const chosen = await service.chooseApplicationRun?.({
      root,
      applicationId: "default",
      runId: earlier.runId,
      reason: "  The earlier summary reads better.  ",
    });
    expect(chosen?.chosenRun).toMatchObject({
      runId: earlier.runId,
      reason: "The earlier summary reads better.",
    });
    // Choosing deletes nothing: both runs stay.
    expect(chosen?.runs.map((run) => run.id).sort()).toEqual([earlier.runId, latest.runId].sort());

    await service.lifecycle({ root, action: "approve", runId: earlier.runId }, silent);
    const exportPath = await service.export({ root, runId: earlier.runId }, silent);
    expect((await stat(exportPath)).isFile()).toBe(true);
    expect((await service.status({ root, runId: earlier.runId }))?.state).toBe("exported");
    expect((await service.status({ root, runId: latest.runId }))?.state).toBe(latest.state);

    const storage = openSqliteStorage(join(root, ".draft-loop", "history.sqlite"));
    try {
      const events = (await storage.listAuditEvents(earlier.workspaceId)).filter(
        (event) => event.eventType === applicationRunChosenEventType,
      );
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        entityType: "application",
        entityId: "default",
        payload: {
          applicationId: "default",
          runId: earlier.runId,
          reason: "The earlier summary reads better.",
        },
      });
    } finally {
      await storage.close();
    }

    // A later choice replaces the earlier one; no reason is stored as null.
    const again = await service.chooseApplicationRun?.({
      root,
      applicationId: "default",
      runId: latest.runId,
    });
    expect(again?.chosenRun).toMatchObject({ runId: latest.runId, reason: null });
  });

  it("clears the choice when a new run starts, with an audit event naming the chosen run", async () => {
    const { root, service } = await workspace();
    const earlier = await service.start({ root, allowProviderData: false }, silent);
    await service.start({ root, allowProviderData: false }, silent);
    await service.chooseApplicationRun?.({ root, applicationId: "default", runId: earlier.runId });

    const started = await service.begin({ root, allowProviderData: false }, silent);
    const application = await service.getApplication({ root, applicationId: "default" });
    expect(application?.chosenRun).toBeNull();
    expect(application?.runs.map((run) => run.id)).toContain(earlier.runId);

    const storage = openSqliteStorage(join(root, ".draft-loop", "history.sqlite"));
    try {
      const cleared = (await storage.listAuditEvents(earlier.workspaceId)).filter(
        (event) => event.eventType === applicationRunChoiceClearedEventType,
      );
      expect(cleared).toHaveLength(1);
      expect(cleared[0]).toMatchObject({
        id: `application-run-choice-cleared:default:${started.runId}`,
        entityType: "application",
        entityId: "default",
        payload: { applicationId: "default", runId: earlier.runId },
      });
    } finally {
      await storage.close();
    }

    // A start with no choice to clear appends nothing.
    await service.start({ root, allowProviderData: false }, silent);
    const after = openSqliteStorage(join(root, ".draft-loop", "history.sqlite"));
    try {
      expect(
        (await after.listAuditEvents(earlier.workspaceId)).filter(
          (event) => event.eventType === applicationRunChoiceClearedEventType,
        ),
      ).toHaveLength(1);
    } finally {
      await after.close();
    }
  });

  it("refuses a run of another application, an unknown run or application, and a long reason", async () => {
    const { root, service } = await workspace();
    const run = await service.start({ root, allowProviderData: false }, silent);
    const other = await service.createApplication({
      root,
      name: "Other",
      jobSource: { kind: "pasted-text", text: "# Other role\n\nDo things.\n" },
    });
    const choose = (applicationId: string, runId: string, reason?: string) =>
      service.chooseApplicationRun?.({
        root,
        applicationId,
        runId,
        ...(reason === undefined ? {} : { reason }),
      });
    await expect(choose(other.id, run.runId)).rejects.toThrow(
      "That run does not belong to this application.",
    );
    await expect(choose("default", "run-missing")).rejects.toThrow(
      "That run does not belong to this application.",
    );
    await expect(choose("app-missing", run.runId)).rejects.toThrow(/was not found/u);
    await expect(choose("default", run.runId, "x".repeat(501))).rejects.toThrow(
      /at most 500 characters/u,
    );
    expect((await service.getApplication({ root, applicationId: "default" }))?.chosenRun).toBe(
      null,
    );
  });

  it("refuses a run without a draft and bounds the reason", async () => {
    const storage = { applications: { setChosenRun: vi.fn() } };
    await expect(
      chooseApplicationRun(
        { root: "/workspace", applicationId: "default", runId: "run-1" },
        {
          storage: storage as never,
          workspaceId: "workspace-1",
          runIds: ["run-1"],
          hasArtifact: async () => false,
          now: () => "2030-01-01T00:00:00.000Z",
        },
      ),
    ).rejects.toThrow("That run has no draft to use yet.");
    expect(storage.applications.setChosenRun).not.toHaveBeenCalled();

    expect(normalizeChosenRunReason(undefined)).toBeNull();
    expect(normalizeChosenRunReason("   ")).toBeNull();
    expect(normalizeChosenRunReason(" Line one\nline two ")).toBe("Line one\nline two");
    expect(() => normalizeChosenRunReason("bell\u0007")).toThrow(CliUserError);
  });
});
