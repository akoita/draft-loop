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
    expect(storage.appliedMigrationVersions().at(-1)).toBe(30);
    expect((await storage.getWorkspace(workspaceId))?.createdAt).toBe(createdAt);
    expect(await storage.applications.listApplications(workspaceId)).toEqual([]);
    expect(await storage.applications.listRuns(workspaceId, "default")).toEqual([]);

    storage.close();
    storage = new SqliteStorage(filename);
    expect(storage.appliedMigrationVersions().filter((version) => version === 30)).toHaveLength(1);
  });
});
