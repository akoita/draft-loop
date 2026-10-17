import { randomUUID } from "node:crypto";
import { auditEventChecksum } from "@draft-loop/storage/audit-trail";
import { describeHistoryRecordsConformance } from "@draft-loop/storage/conformance";
import { describe, expect, it } from "vitest";
import { postgresMigrations } from "./migrations.js";
import { openPostgresStorage, type PostgresStorage } from "./postgres-storage.js";
import { createSqlClient } from "./sql-client.js";

/**
 * Set by the Postgres CI job and by developers with a local server. Without it these suites are
 * skipped, so the workspace gate runs where no database is available.
 */
const connectionString = process.env.DRAFT_LOOP_TEST_POSTGRES_URL;

/** Opens an empty store in a schema of its own, dropped again on close. */
async function openIsolated(url: string): Promise<{
  readonly storage: PostgresStorage;
  readonly close: () => Promise<void>;
}> {
  const schema = `conformance_${randomUUID().replaceAll("-", "")}`;
  const admin = createSqlClient({ connectionString: url, maxConnections: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const storage = await openPostgresStorage({ connectionString: url, schema });
  return {
    storage,
    close: async () => {
      await storage.close();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.close();
    },
  };
}

describe.runIf(connectionString !== undefined)("Postgres storage", () => {
  const url = connectionString ?? "";

  // Every history and versioned-record group, as SQLite runs them.
  describeHistoryRecordsConformance("Postgres", () => openIsolated(url));

  it("chains concurrent writes to one workspace into a single verifiable sequence", async () => {
    const { storage, close } = await openIsolated(url);
    try {
      await storage.saveWorkspace({
        id: "workspace-1",
        state: "collecting",
        createdAt: "2026-10-17T10:00:00.000Z",
        updatedAt: "2026-10-17T10:00:00.000Z",
      });
      await Promise.all(
        Array.from({ length: 8 }, (_, index) =>
          storage.saveContextSnapshot({
            id: `context-${index}`,
            workspaceId: "workspace-1",
            schemaVersion: 1,
            createdAt: "2026-10-17T10:01:00.000Z",
            payload: { index },
          }),
        ),
      );
      const events = await storage.listAuditEvents("workspace-1");
      expect(events).toHaveLength(9);
      let previous: string | null = null;
      for (const event of events) {
        expect(event.previousEventChecksum).toBe(previous);
        expect(event.eventChecksum).toBe(
          auditEventChecksum({
            createdAt: event.createdAt,
            entityId: event.entityId,
            entityType: event.entityType,
            eventType: event.eventType,
            id: event.id,
            payloadChecksum: event.payloadChecksum,
            previousEventChecksum: event.previousEventChecksum,
            workspaceId: event.workspaceId,
          }),
        );
        previous = event.eventChecksum;
      }
    } finally {
      await close();
    }
  });

  it("reports tampered audit payloads and run snapshots", async () => {
    const schema = `tamper_${randomUUID().replaceAll("-", "")}`;
    const admin = createSqlClient({ connectionString: url, maxConnections: 1 });
    await admin.query(`CREATE SCHEMA ${schema}`);
    const storage = await openPostgresStorage({ connectionString: url, schema });
    try {
      const at = "2026-10-17T10:00:00.000Z";
      await storage.saveWorkspace({
        id: "workspace-1",
        state: "drafting",
        createdAt: at,
        updatedAt: at,
      });
      await storage.saveContextSnapshot({
        id: "context-1",
        workspaceId: "workspace-1",
        schemaVersion: 1,
        createdAt: at,
        payload: { job: "fixture" },
      });
      const snapshot = await storage.saveRunSnapshot({
        workspaceId: "workspace-1",
        runId: "run-1",
        contextSnapshotId: "context-1",
        state: "drafting",
        round: 1,
        currentStep: "author",
        budget: { maxRounds: 2 },
        artifactId: null,
        approval: "pending",
        totalCostUsd: 0,
        startedAt: at,
        updatedAt: at,
        lastError: null,
        payload: { step: 1 },
      });
      await expect(storage.auditEvents.verifyAuditChain("workspace-1")).resolves.toMatchObject({
        ok: true,
        eventCount: 3,
      });

      // Bypass the immutability triggers, as a direct database edit would.
      await admin.transaction(async (executor) => {
        await executor.query("SET LOCAL session_replication_role = replica");
        await executor.query(
          `UPDATE ${schema}.run_snapshots SET payload_json = '{"step":2}' WHERE id = $1`,
          [snapshot.id],
        );
        await executor.query(
          `UPDATE ${schema}.audit_events SET payload_json = '{"job":"changed"}' WHERE entity_type = 'context-snapshot'`,
        );
      });
      const result = await storage.auditEvents.verifyAuditChain("workspace-1");
      expect(result.ok).toBe(false);
      expect(result.problems.map((problem) => problem.code).sort()).toEqual([
        "payload-checksum",
        "snapshot-checksum",
      ]);
      await expect(
        storage.auditEvents.findLatestAuditEvent({
          workspaceId: "workspace-1",
          eventType: "run-snapshot.appended",
          entityType: "run-snapshot",
          entityId: "run-1",
        }),
      ).resolves.toMatchObject({ id: `${snapshot.id}:audit` });
    } finally {
      await storage.close();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.close();
    }
  });

  it("applies each migration once when several stores open the same schema", async () => {
    const schema = `migrations_${randomUUID().replaceAll("-", "")}`;
    const admin = createSqlClient({ connectionString: url, maxConnections: 1 });
    await admin.query(`CREATE SCHEMA ${schema}`);
    try {
      const stores = await Promise.all(
        Array.from({ length: 3 }, () => openPostgresStorage({ connectionString: url, schema })),
      );
      await Promise.all(stores.map((store) => store.close()));
      const rows = await admin.query(`SELECT version FROM ${schema}.schema_migrations`);
      expect(rows.map((row) => Number(row.version)).sort((left, right) => left - right)).toEqual(
        postgresMigrations.map((migration) => migration.version),
      );
    } finally {
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.close();
    }
  });
});
