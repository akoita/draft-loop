import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHostedKnowledgeIntake } from "@draft-loop/application";
import { createFilesystemBlobStorage } from "@draft-loop/storage/blobs";
import {
  createSqlClient,
  grantPostgresStorageAccess,
  migratePostgresStorage,
  openPostgresCandidateKnowledgeStore,
  openPostgresStorage,
  type PostgresStorage,
} from "@draft-loop/storage-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/** Set by the CI `Server storage` job and by developers with a local server; skipped otherwise. */
const connectionString = process.env.DRAFT_LOOP_TEST_POSTGRES_URL;

const runtimeRole = "draft_loop_test_app";
const career = new TextEncoder().encode(
  "# Experience\n\n## Platform Engineer, Example Ledger (2020-2024)\n\nBuilt TypeScript services.\n",
);

function runtimeUrl(url: string): string {
  const parsed = new URL(url);
  parsed.username = runtimeRole;
  parsed.password = runtimeRole;
  return parsed.toString();
}

describe.runIf(connectionString !== undefined)("hosted knowledge intake on Postgres", () => {
  const url = connectionString ?? "";
  const schema = `intake_${randomUUID().replaceAll("-", "")}`;
  const admin = createSqlClient({ connectionString: url, maxConnections: 1 });
  let storage: PostgresStorage;
  let blobRoot: string;

  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.query(`DO $$
      BEGIN
        CREATE ROLE ${runtimeRole} LOGIN PASSWORD '${runtimeRole}';
      EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL;
      END $$`);
    await migratePostgresStorage({ connectionString: url, schema });
    await grantPostgresStorageAccess({ connectionString: url, schema }, runtimeRole);
    storage = await openPostgresStorage({
      connectionString: runtimeUrl(url),
      schema,
      tenantId: "tenant-a",
    });
    blobRoot = await mkdtemp(join(tmpdir(), "draft-loop-intake-"));
  });

  afterAll(async () => {
    await storage?.close();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.close();
    await rm(blobRoot, { recursive: true, force: true });
  });

  it("leaves an uploaded source that a run's knowledge store reads back", async () => {
    const blobs = createFilesystemBlobStorage();
    const intake = createHostedKnowledgeIntake({
      records: storage,
      blobs,
      storeId: "knowledge",
      locate: (versionId) => join(blobRoot, "knowledge", versionId),
    });

    const base = await intake.createKnowledgeBase({ displayName: "Career" });
    const added = await intake.addFileSource({
      knowledgeBaseId: base.id,
      displayName: "career.md",
      mediaType: "text/markdown",
      bytes: career,
    });
    const again = await intake.addFileSource({
      knowledgeBaseId: base.id,
      displayName: "career.md",
      mediaType: "text/markdown",
      bytes: career,
    });

    expect(again).toEqual({ ...added, created: false });
    expect((await intake.listSources(base.id)).map(({ source }) => source.id)).toEqual([
      added.source.id,
    ]);
    const store = await openPostgresCandidateKnowledgeStore({
      storage,
      blobs,
      storeId: "knowledge",
    });
    const read = await store.readManagedCandidateKnowledgeSourceVersion(
      base.id,
      added.source.id,
      added.latestVersion.id,
    );
    expect(read?.bytes).toEqual(career);
    const readiness = await store.getCandidateKnowledgeBaseLifecycleReadiness(base.id);
    expect(readiness?.sources.map(({ sourceId, status }) => ({ sourceId, status }))).toEqual([
      { sourceId: added.source.id, status: "ready" },
    ]);
  });
});
