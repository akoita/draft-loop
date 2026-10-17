import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteStorage } from "./index.js";

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
  it("keeps run and brief bindings immutable in the database", async () => {
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
    await applications.bindRun({ workspaceId, applicationId: "app-a", runId: "run-1", createdAt });
    await applications.bindBrief({
      workspaceId,
      applicationId: "app-b",
      briefId: "brief-1",
      createdAt,
    });
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
    expect(storage.appliedMigrationVersions().at(-1)).toBe(36);
    expect((await storage.getWorkspace(workspaceId))?.createdAt).toBe(createdAt);
    expect(await storage.applications.listApplications(workspaceId)).toEqual([]);
    expect(await storage.applications.listRuns(workspaceId, "default")).toEqual([]);

    storage.close();
    storage = new SqliteStorage(filename);
    expect(storage.appliedMigrationVersions().filter((version) => version === 30)).toHaveLength(1);
  });
});
