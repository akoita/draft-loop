import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteStorage, StorageConflictError, StorageValidationError } from "./index.js";

interface RawDatabase {
  readonly prepare: (sql: string) => {
    readonly get: (...args: unknown[]) => Record<string, unknown> | undefined;
    readonly all: (...args: unknown[]) => Record<string, unknown>[];
    readonly run: (...args: unknown[]) => unknown;
  };
  readonly exec: (sql: string) => void;
  readonly close: () => void;
}

const openRaw = createRequire(import.meta.url)("better-sqlite3") as new (
  path: string,
) => RawDatabase;

const workspaceId = "workspace-applications";
const createdAt = "2030-01-01T00:00:00.000Z";
const jobSource = { kind: "local-file", path: "/synthetic/jobs/acme.md" } as const;

let directory: string;
let filename: string;
let storage: SqliteStorage;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "draft-loop-applications-"));
  filename = join(directory, "history.sqlite");
  storage = new SqliteStorage(filename);
  await storage.saveWorkspace({
    id: workspaceId,
    state: "collecting",
    createdAt,
    updatedAt: createdAt,
  });
});

afterEach(async () => {
  storage.close();
  await rm(directory, { recursive: true, force: true });
});

describe("application storage", () => {
  it("creates, gets and lists applications oldest first", async () => {
    const { applications } = storage;
    await applications.insertApplication({
      workspaceId,
      id: "app-b",
      name: "  Beta — Designer ",
      jobSource,
      createdAt: "2030-01-02T00:00:00.000Z",
    });
    await applications.insertApplication({
      workspaceId,
      id: "app-a",
      name: "Acme — Engineer",
      jobSource,
      createdAt,
    });

    expect((await applications.getApplication(workspaceId, "app-b"))?.name).toBe("Beta — Designer");
    expect(await applications.getApplication(workspaceId, "missing")).toBeUndefined();
    expect((await applications.listApplications(workspaceId)).map((item) => item.id)).toEqual([
      "app-a",
      "app-b",
    ]);
    expect(await applications.listApplications("other-workspace")).toEqual([]);
  });

  it("rejects duplicate ids, the reserved default id, bad names and bad sources", async () => {
    const { applications } = storage;
    const base = { workspaceId, id: "app-a", name: "Acme", jobSource, createdAt };
    await applications.insertApplication(base);
    await expect(applications.insertApplication(base)).rejects.toBeInstanceOf(StorageConflictError);
    await expect(applications.insertApplication({ ...base, id: "default" })).rejects.toBeInstanceOf(
      StorageValidationError,
    );
    await expect(
      applications.insertApplication({ ...base, id: "b", name: "  " }),
    ).rejects.toThrow();
    await expect(
      applications.insertApplication({
        ...base,
        id: "b",
        jobSource: { kind: "approved-url", url: "https://x.test", approved: false } as never,
      }),
    ).rejects.toThrow();
  });

  it("binds a run once, treats unbound runs as the default application and keeps bindings immutable", async () => {
    const { applications } = storage;
    await applications.insertApplication({
      workspaceId,
      id: "app-a",
      name: "A",
      jobSource,
      createdAt,
    });
    await applications.insertApplication({
      workspaceId,
      id: "app-b",
      name: "B",
      jobSource,
      createdAt,
    });

    expect(await applications.applicationIdForRun(workspaceId, "run-legacy")).toBe("default");
    await applications.bindRun({ workspaceId, applicationId: "app-a", runId: "run-1", createdAt });
    await applications.bindRun({ workspaceId, applicationId: "app-a", runId: "run-1", createdAt });
    expect(await applications.applicationIdForRun(workspaceId, "run-1")).toBe("app-a");
    await expect(
      applications.bindRun({ workspaceId, applicationId: "app-b", runId: "run-1", createdAt }),
    ).rejects.toBeInstanceOf(StorageConflictError);
    await expect(
      applications.bindRun({ workspaceId, applicationId: "default", runId: "run-2", createdAt }),
    ).rejects.toBeInstanceOf(StorageValidationError);
    await expect(
      applications.bindBrief({
        workspaceId,
        applicationId: "missing",
        briefId: "brief-1",
        createdAt,
      }),
    ).rejects.toBeInstanceOf(StorageValidationError);

    await applications.bindBrief({
      workspaceId,
      applicationId: "app-b",
      briefId: "brief-1",
      createdAt,
    });
    expect(await applications.applicationIdForBrief(workspaceId, "brief-1")).toBe("app-b");
    expect(await applications.applicationIdForBrief(workspaceId, "brief-legacy")).toBe("default");

    storage.close();
    const raw = new openRaw(filename);
    expect(() => raw.exec("UPDATE application_run_bindings SET application_id = 'app-b'")).toThrow(
      /immutable/u,
    );
    expect(() => raw.exec("DELETE FROM application_brief_bindings")).toThrow(/immutable/u);
    raw.close();
    storage = new SqliteStorage(filename);
  });

  it("archives and restores applications, including the default one", async () => {
    const { applications } = storage;
    await applications.insertApplication({
      workspaceId,
      id: "app-a",
      name: "A",
      jobSource,
      createdAt,
    });
    expect(await applications.listArchived(workspaceId)).toEqual(new Map());

    await applications.setArchived(workspaceId, "app-a", "2030-01-03T00:00:00.000Z");
    await applications.setArchived(workspaceId, "app-a", "2030-01-04T00:00:00.000Z");
    await applications.setArchived(workspaceId, "default", "2030-01-05T00:00:00.000Z");
    expect(await applications.listArchived(workspaceId)).toEqual(
      new Map([
        ["app-a", "2030-01-03T00:00:00.000Z"],
        ["default", "2030-01-05T00:00:00.000Z"],
      ]),
    );
    expect(await applications.listArchived("another-workspace")).toEqual(new Map());

    await applications.setArchived(workspaceId, "app-a", null);
    await applications.setArchived(workspaceId, "app-a", null);
    expect([...(await applications.listArchived(workspaceId)).keys()]).toEqual(["default"]);
  });

  it("renames a created application on its row and the default application beside it", async () => {
    const { applications } = storage;
    await applications.insertApplication({
      workspaceId,
      id: "app-a",
      name: "Acme",
      jobSource,
      createdAt,
    });
    const renamedAt = "2030-01-03T00:00:00.000Z";

    await applications.renameApplication(
      workspaceId,
      "app-a",
      "  Acme — Staff Engineer ",
      renamedAt,
    );
    expect(await applications.getApplication(workspaceId, "app-a")).toMatchObject({
      name: "Acme — Staff Engineer",
      updatedAt: renamedAt,
    });

    expect(await applications.getDefaultApplicationName(workspaceId)).toBeUndefined();
    await applications.renameApplication(workspaceId, "default", "Beta — Designer", renamedAt);
    await applications.renameApplication(workspaceId, "default", "Beta — Lead Designer", renamedAt);
    expect(await applications.getDefaultApplicationName(workspaceId)).toBe("Beta — Lead Designer");
    expect(await applications.getDefaultApplicationName("other-workspace")).toBeUndefined();

    await expect(
      applications.renameApplication(workspaceId, "missing", "Name", renamedAt),
    ).rejects.toBeInstanceOf(StorageValidationError);
    await expect(
      applications.renameApplication(workspaceId, "app-a", "   ", renamedAt),
    ).rejects.toBeInstanceOf(StorageValidationError);
    await expect(
      applications.renameApplication(workspaceId, "default", "x".repeat(121), renamedAt),
    ).rejects.toBeInstanceOf(StorageValidationError);
  });

  it("sets, replaces and clears an application's own model pair", async () => {
    const { applications } = storage;
    await applications.insertApplication({
      workspaceId,
      id: "app-a",
      name: "Acme — Engineer",
      jobSource,
      createdAt,
    });
    const frontier = {
      author: { id: "anthropic-frontier", version: 1 },
      critic: { id: "openai-frontier", version: 2 },
    };
    expect(await applications.getModelProfiles(workspaceId, "app-a")).toBeUndefined();
    await applications.setModelProfiles(workspaceId, "app-a", frontier, createdAt);
    expect(await applications.getModelProfiles(workspaceId, "app-a")).toEqual(frontier);
    const replaced = { ...frontier, critic: { id: "openai-economy", version: 1 } };
    await applications.setModelProfiles(workspaceId, "app-a", replaced, createdAt);
    expect(await applications.getModelProfiles(workspaceId, "app-a")).toEqual(replaced);
    await applications.setModelProfiles(workspaceId, "app-a", null, createdAt);
    expect(await applications.getModelProfiles(workspaceId, "app-a")).toBeUndefined();

    await expect(
      applications.setModelProfiles(workspaceId, "default", frontier, createdAt),
    ).rejects.toBeInstanceOf(StorageValidationError);
    await expect(
      applications.setModelProfiles(workspaceId, "app-missing", frontier, createdAt),
    ).rejects.toBeInstanceOf(StorageValidationError);
    await expect(
      applications.setModelProfiles(
        workspaceId,
        "app-a",
        { ...frontier, author: { id: "anthropic-frontier", version: 0 } },
        createdAt,
      ),
    ).rejects.toBeInstanceOf(StorageValidationError);

    // Deleting an empty application removes its pair with it.
    await applications.setModelProfiles(workspaceId, "app-a", frontier, createdAt);
    await applications.deleteApplication(workspaceId, "app-a");
    expect(await applications.getModelProfiles(workspaceId, "app-a")).toBeUndefined();
  });

  it("deletes an empty application and refuses one that holds runs or briefs", async () => {
    const { applications } = storage;
    for (const id of ["app-empty", "app-run", "app-brief"]) {
      await applications.insertApplication({ workspaceId, id, name: id, jobSource, createdAt });
    }
    await applications.setArchived(workspaceId, "app-empty", createdAt);
    await applications.bindRun({
      workspaceId,
      applicationId: "app-run",
      runId: "run-1",
      createdAt,
    });
    await applications.bindBrief({
      workspaceId,
      applicationId: "app-brief",
      briefId: "brief-1",
      createdAt,
    });

    await applications.deleteApplication(workspaceId, "app-empty");
    expect(await applications.getApplication(workspaceId, "app-empty")).toBeUndefined();
    expect(await applications.listArchived(workspaceId)).toEqual(new Map());

    await expect(applications.deleteApplication(workspaceId, "app-run")).rejects.toBeInstanceOf(
      StorageConflictError,
    );
    await expect(applications.deleteApplication(workspaceId, "app-brief")).rejects.toBeInstanceOf(
      StorageConflictError,
    );
    await expect(applications.deleteApplication(workspaceId, "default")).rejects.toBeInstanceOf(
      StorageValidationError,
    );
    await expect(applications.deleteApplication(workspaceId, "app-empty")).rejects.toBeInstanceOf(
      StorageValidationError,
    );
    expect((await applications.listApplications(workspaceId)).map((item) => item.id)).toEqual([
      "app-brief",
      "app-run",
    ]);
  });

  it("lists a run with the state of its latest snapshot, not the state it was appended with", async () => {
    const { applications } = storage;
    await applications.insertApplication({
      workspaceId,
      id: "app-run",
      name: "Run",
      jobSource,
      createdAt,
    });
    await storage.saveContextSnapshot({
      id: "context-1",
      workspaceId,
      schemaVersion: 1,
      createdAt,
      payload: { job: "fixture" },
    });
    const record = {
      workspaceId,
      contextSnapshotId: "context-1",
      round: 1,
      currentStep: "author",
      budget: { maxRounds: 3 },
      artifactId: null,
      approval: "pending",
      totalCostUsd: 0,
      startedAt: createdAt,
      lastError: null,
    } as const;
    await storage.saveRun({
      ...record,
      id: "run-1",
      state: "collecting",
      updatedAt: createdAt,
      payload: {},
    });
    await applications.bindRun({
      workspaceId,
      applicationId: "app-run",
      runId: "run-1",
      createdAt,
    });
    expect(await applications.listRuns(workspaceId, "app-run")).toEqual([
      { id: "run-1", state: "collecting", startedAt: createdAt, updatedAt: createdAt },
    ]);

    for (const [state, updatedAt] of [
      ["drafting", "2030-01-01T00:01:00.000Z"],
      ["awaiting-approval", "2030-01-01T00:02:00.000Z"],
    ] as const) {
      await storage.saveRunSnapshot({ ...record, runId: "run-1", state, updatedAt, payload: {} });
    }
    expect(await applications.listRuns(workspaceId, "app-run")).toEqual([
      {
        id: "run-1",
        state: "awaiting-approval",
        startedAt: createdAt,
        updatedAt: "2030-01-01T00:02:00.000Z",
      },
    ]);
  });

  it("records, replaces and reads an application's chosen run, and refuses another's run", async () => {
    const { applications } = storage;
    await applications.insertApplication({
      workspaceId,
      id: "app-a",
      name: "A",
      jobSource,
      createdAt,
    });
    await applications.insertApplication({
      workspaceId,
      id: "app-b",
      name: "B",
      jobSource,
      createdAt,
    });
    await storage.saveContextSnapshot({
      id: "context-chosen",
      workspaceId,
      schemaVersion: 1,
      createdAt,
      payload: { job: "fixture" },
    });
    for (const id of ["run-a1", "run-a2", "run-default"]) {
      await storage.saveRun({
        id,
        workspaceId,
        contextSnapshotId: "context-chosen",
        state: "awaiting-approval",
        round: 1,
        currentStep: "author",
        budget: { maxRounds: 3 },
        artifactId: null,
        approval: "pending",
        totalCostUsd: 0,
        startedAt: createdAt,
        updatedAt: createdAt,
        lastError: null,
        payload: {},
      });
    }
    for (const runId of ["run-a1", "run-a2"]) {
      await applications.bindRun({ workspaceId, applicationId: "app-a", runId, createdAt });
    }

    const event = (id: string, applicationId: string, runId = "run") => ({
      id,
      workspaceId,
      eventType: "application.run-chosen",
      entityType: "application",
      entityId: applicationId,
      payload: { applicationId, runId },
      createdAt,
    });
    const eventIds = async () =>
      (await storage.listAuditEvents(workspaceId))
        .filter((item) => item.entityType === "application")
        .map((item) => item.id);

    expect(await applications.getChosenRun(workspaceId, "app-a")).toBeUndefined();
    await applications.setChosenRun(
      workspaceId,
      "app-a",
      {
        runId: "run-a1",
        chosenAt: createdAt,
        reason: "Tighter summary",
      },
      event("chosen-1", "app-a"),
    );
    await applications.setChosenRun(
      workspaceId,
      "default",
      {
        runId: "run-default",
        chosenAt: createdAt,
        reason: null,
      },
      event("chosen-2", "default"),
    );
    expect(await applications.getChosenRun(workspaceId, "app-a")).toEqual({
      runId: "run-a1",
      chosenAt: createdAt,
      reason: "Tighter summary",
    });
    await applications.setChosenRun(
      workspaceId,
      "app-a",
      {
        runId: "run-a2",
        chosenAt: "2030-01-02T00:00:00.000Z",
        reason: null,
      },
      event("chosen-3", "app-a"),
    );
    expect(await applications.getChosenRun(workspaceId, "app-a")).toEqual({
      runId: "run-a2",
      chosenAt: "2030-01-02T00:00:00.000Z",
      reason: null,
    });
    expect(await applications.getChosenRun(workspaceId, "default")).toMatchObject({
      runId: "run-default",
    });
    // Choosing never removes a run.
    expect((await applications.listRuns(workspaceId, "app-a")).map((run) => run.id)).toEqual([
      "run-a1",
      "run-a2",
    ]);

    for (const [applicationId, runId] of [
      ["app-b", "run-a1"],
      ["app-a", "run-default"],
      ["app-a", "run-missing"],
    ] as const) {
      await expect(
        applications.setChosenRun(
          workspaceId,
          applicationId,
          {
            runId,
            chosenAt: createdAt,
            reason: null,
          },
          event("chosen-4", applicationId),
        ),
      ).rejects.toBeInstanceOf(StorageValidationError);
    }
    for (const reason of ["", "x".repeat(501)]) {
      await expect(
        applications.setChosenRun(
          workspaceId,
          "app-a",
          {
            runId: "run-a1",
            chosenAt: createdAt,
            reason,
          },
          event("chosen-5", "app-a"),
        ),
      ).rejects.toBeInstanceOf(StorageValidationError);
    }
    expect(await applications.getChosenRun(workspaceId, "app-a")).toMatchObject({
      runId: "run-a2",
    });
    // Each recorded choice wrote its audit event; refused ones wrote none.
    expect(await eventIds()).toEqual(["chosen-1", "chosen-2", "chosen-3"]);

    // The choice and its event are one transaction: an event that cannot be written leaves the
    // choice as it was.
    await expect(
      applications.setChosenRun(
        workspaceId,
        "app-a",
        { runId: "run-a1", chosenAt: createdAt, reason: null },
        { ...event("chosen-1", "app-a"), payload: { applicationId: "app-a", runId: "changed" } },
      ),
    ).rejects.toBeInstanceOf(StorageConflictError);
    expect(await applications.getChosenRun(workspaceId, "app-a")).toMatchObject({
      runId: "run-a2",
    });

    // Clearing removes the choice and appends the event built from it, together.
    const cleared = await applications.clearChosenRun(workspaceId, "app-a", (choice) => ({
      ...event("cleared-1", "app-a", choice.runId),
      eventType: "application.run-choice-cleared",
    }));
    expect(cleared).toMatchObject({ runId: "run-a2" });
    expect(await applications.getChosenRun(workspaceId, "app-a")).toBeUndefined();
    expect((await storage.listAuditEvents(workspaceId)).at(-1)).toMatchObject({
      id: "cleared-1",
      eventType: "application.run-choice-cleared",
      payload: { applicationId: "app-a", runId: "run-a2" },
    });
    expect(
      await applications.clearChosenRun(workspaceId, "app-a", () => event("cleared-2", "app-a")),
    ).toBeUndefined();
    await expect(
      applications.clearChosenRun(workspaceId, "default", () => event("chosen-2", "app-a")),
    ).rejects.toBeInstanceOf(StorageConflictError);
    expect(await applications.getChosenRun(workspaceId, "default")).toMatchObject({
      runId: "run-default",
    });
    expect(await eventIds()).toEqual(["chosen-1", "chosen-2", "chosen-3", "cleared-1"]);
  });

  it("applies migration 30 to an existing database without touching existing rows", async () => {
    storage.close();
    // A v29 database has no application tables or migration row; every other table is the same.
    const legacy = new openRaw(filename);
    legacy.exec(`
      DROP TABLE application_run_bindings;
      DROP TABLE application_brief_bindings;
      DROP TABLE applications;
      DELETE FROM schema_migrations WHERE version = 30;
    `);
    expect(
      legacy.prepare("SELECT name FROM sqlite_master WHERE name = 'applications'").get(),
    ).toBeUndefined();
    legacy.close();

    storage = new SqliteStorage(filename);
    expect(storage.appliedMigrationVersions().at(-1)).toBe(36);
    expect((await storage.getWorkspace(workspaceId))?.createdAt).toBe(createdAt);
    expect(await storage.applications.listApplications(workspaceId)).toEqual([]);
    expect(await storage.applications.listRuns(workspaceId, "default")).toEqual([]);

    storage.close();
    storage = new SqliteStorage(filename);
    expect(storage.appliedMigrationVersions().filter((version) => version === 30)).toHaveLength(1);
  });
});
